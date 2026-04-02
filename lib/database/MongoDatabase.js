// NUR relevante Änderungen sind kommentiert mit 🔥
// Rest ist unverändert von dir übernommen

import Base from "../foundation/Base.js";

import { DB_CONNECTION, DB_NAME, GEMINI_API_KEY } from "#config";
import MongoCollectionReadWrite from "../database/dao/MongoCollectionReadWrite.js";
import MongoCollectionReadOnly from "../database/dao/MongoCollectionReadOnly.js";

import { ObjectId, MongoClient } from "mongodb";
import { GoogleGenerativeAI } from "@google/generative-ai";

import { validatePassword } from "../utils/validatePassword.js";
import { PASSWORD_RULES } from "../../configuration/passwordRules.js";

import bcrypt from "bcrypt";
import crypto from "crypto";

import "dotenv/config";

class MongoDatabase extends Base {
  constructor() {
    super();

    let instance = this;

    instance.questionDAO = null;
    instance.answerDAO = null;
    instance.testDAO = null;
    instance.testAnswersDAO = null;
    instance.userDAO = null;

    instance.genAI = null;
    instance.genAIModel = null;
  }

  async init(logManager) {
    super.init(logManager);

    let instance = this;

    instance.dbConnectionString = DB_CONNECTION;
    instance.dbName = DB_NAME;

    instance.genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    instance.genAIModel = instance.genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
    });

    if (instance.client) return;

    instance.client = new MongoClient(instance.dbConnectionString);
    await instance.client.connect();
    const DB = instance.client.db(instance.dbName);

    const question = DB.collection("question");
    class QuestionDAO extends MongoCollectionReadOnly {}
    instance.questionDAO = new QuestionDAO(question);
    instance.questionDAO.init(logManager);

    const answer = DB.collection("answer");
    class AnswerDAO extends MongoCollectionReadOnly {}
    instance.answerDAO = new AnswerDAO(answer);
    instance.answerDAO.init(logManager);

    const test = DB.collection("test");
    class TestDAO extends MongoCollectionReadWrite {}
    instance.testDAO = new TestDAO(test, () => true);
    instance.testDAO.init(logManager);

    const test_answers = DB.collection("test_answers");
    class TestAnswersDAO extends MongoCollectionReadWrite {}
    instance.testAnswersDAO = new TestAnswersDAO(test_answers, () => true);
    instance.testAnswersDAO.init(logManager);

    /*
    ==============================================
    🔥 USER VALIDATOR ERWEITERT
    ==============================================
    */

    const userValidator = (user) => {
      if (!user) throw new Error("User not defined!");

      const hasDotNotation = Object.keys(user).some((k) => k.includes("."));
      if (hasDotNotation) return true;

      if (user.email !== undefined && typeof user.email !== "string") {
        throw new Error("Invalid email");
      }

      if (user.twoFactor !== undefined) {
        if (typeof user.twoFactor !== "object") {
          throw new Error("twoFactor must be object");
        }

        if (
          user.twoFactor.loginAttempts !== undefined &&
          typeof user.twoFactor.loginAttempts !== "number"
        ) {
          throw new Error("loginAttempts must be number");
        }

        if (
          user.twoFactor.lockUntil !== undefined &&
          user.twoFactor.lockUntil !== null &&
          !(user.twoFactor.lockUntil instanceof Date)
        ) {
          throw new Error("lockUntil must be Date");
        }
      }

      return true;
    };

    const user = DB.collection("user");
    class UserDAO extends MongoCollectionReadWrite {}
    instance.userDAO = new UserDAO(user, userValidator);
    instance.userDAO.init(logManager);

    const cache = DB.collection("cache");
    class CacheDAO extends MongoCollectionReadWrite {}
    instance.cacheDAO = new CacheDAO(cache, () => true);
    instance.cacheDAO.init(logManager);
  }

  async close() {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  /*
  ==============================================
  🔥 NORMALIZE USER (WICHTIG!)
  ==============================================
  */

  normalizeUser(user) {
    if (!user) return null;

    return {
      ...user,
      twoFactor: {
        enabled: !!user?.twoFactor?.enabled,
        secret: user?.twoFactor?.secret || null,
        tempSecret: user?.twoFactor?.tempSecret || null,
        loginAttempts: user?.twoFactor?.loginAttempts || 0, // 🔥
        lockUntil: user?.twoFactor?.lockUntil || null, // 🔥
      },
      mustChangePassword: !!user.mustChangePassword,
    };
  }

  async getUser(email) {
    if (!email) return null;
    const user = await this.userDAO.findOne({ email: email.trim() });
    return this.normalizeUser(user);
  }

  async getUserById(id) {
    if (!id) return null;
    const user = await this.userDAO.findOne({ _id: new ObjectId(id) });
    return this.normalizeUser(user);
  }

  async changePassword(userId, newPassword) {
    const user = await this.getUserById(userId);

    if (!user) {
      throw new Error("USER_NOT_FOUND");
    }

    // ✅ Passwort-Komplexität prüfen
    const isValid = validatePassword(newPassword, PASSWORD_RULES);

    if (!isValid) {
      throw new Error("PASSWORD_WEAK");
    }

    // ✅ prüfen ob gleiches Passwort
    const isSame = await bcrypt.compare(newPassword, user.passwordHash);

    if (isSame) {
      throw new Error("PASSWORD_SAME");
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);

    const result = await this.updateUser(userId, {
      passwordHash,
      mustChangePassword: false,
    });

    return result; // boolean
  }

  /*
  ==============================================
  🔥 CREATE USER (MIT SECURITY FIELDS)
  ==============================================
  */

  async createUser({ email, firstname, lastname }) {
    const normalizedEmail = email.trim();

    // 🔍 Prüfen, ob User existiert
    const existingUser = await this.userDAO.findOne({ email: normalizedEmail });

    const rawPassword = crypto.randomBytes(8).toString("base64");
    const cleanPassword = rawPassword.replace(/[+/=]/g, "A");

    const passwordHash = await bcrypt.hash(cleanPassword, 12);

    // 🔧 Felder, die IMMER gesetzt/aktualisiert werden dürfen
    const updateData = {
      passwordHash,
      mustChangePassword: true,

      twoFactor: {
        enabled: false,
        secret: null,
        tempSecret: null,
        loginAttempts: 0,
        lockUntil: null,
      },
    };

    // ==================================================
    // 🆕 FALL 1: User existiert → UPDATE
    // ==================================================
    if (existingUser) {
      await this.updateUser(existingUser._id, updateData);

      return {
        userId: existingUser._id,
        initialPassword: cleanPassword,
        updated: true, // optional für Debug/UX
      };
    }

    // ==================================================
    // 🆕 FALL 2: Neuer User → CREATE
    // ==================================================
    const user = {
      email: normalizedEmail,
      firstname,
      lastname,

      ...updateData,

      createdAt: new Date(),

      init() {},
    };

    const createdUser = await this.userDAO.create(user);

    return {
      userId: createdUser?._id,
      initialPassword: cleanPassword,
      created: true, // optional
    };
  }

  async updateUser(id, updateObject) {
    console.log(updateObject);

    const result = await this.userDAO.update(id, updateObject);
    return result;
  }

  // --- REST UNVERÄNDERT ---
}

export default new MongoDatabase();
