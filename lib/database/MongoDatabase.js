import Base from "../foundation/Base.js";

import { DB_CONNECTION, DB_NAME, GEMINI_API_KEY } from "#config";
import MongoCollectionReadWrite from "../database/dao/MongoCollectionReadWrite.js";
import MongoCollectionReadOnly from "../database/dao/MongoCollectionReadOnly.js";

import TestInfo from "../database/model/TestInfo.js";
import TestAnswer from "../database/model/TestAnswer.js";

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

    this.questionDAO = null;
    this.answerDAO = null;
    this.testDAO = null;
    this.testAnswersDAO = null;
    this.userDAO = null;
    this.cacheDAO = null;

    this.genAI = null;
    this.genAIModel = null;
  }

  async init(logManager) {
    super.init(logManager);

    this.dbConnectionString = DB_CONNECTION;
    this.dbName = DB_NAME;

    this.genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    this.genAIModel = this.genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
    });

    if (this.client) return;

    this.client = new MongoClient(this.dbConnectionString);
    await this.client.connect();
    const DB = this.client.db(this.dbName);

    // ======================
    // DAOs
    // ======================

    class QuestionDAO extends MongoCollectionReadOnly {}
    this.questionDAO = new QuestionDAO(DB.collection("question"));
    this.questionDAO.init(logManager);

    class AnswerDAO extends MongoCollectionReadOnly {}
    this.answerDAO = new AnswerDAO(DB.collection("answer"));
    this.answerDAO.init(logManager);

    class TestDAO extends MongoCollectionReadWrite {}
    this.testDAO = new TestDAO(DB.collection("test"), (info) => {
      if (typeof info.name !== "string") throw new Error("Invalid name");
      if (typeof info.user_id !== "string") throw new Error("Invalid user");
      return true;
    });
    this.testDAO.init(logManager);

    class TestAnswersDAO extends MongoCollectionReadWrite {}
    this.testAnswersDAO = new TestAnswersDAO(
      DB.collection("test_answers"),
      () => true,
    );
    this.testAnswersDAO.init(logManager);

    // 🔥 USER VALIDATOR (gemerged)
    const userValidator = (user) => {
      if (!user) throw new Error("User not defined!");

      const hasDotNotation = Object.keys(user).some((k) => k.includes("."));
      if (hasDotNotation) return true;

      if (user.email && typeof user.email !== "string") {
        throw new Error("Invalid email");
      }

      if (user.twoFactor) {
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

    class UserDAO extends MongoCollectionReadWrite {}
    this.userDAO = new UserDAO(DB.collection("user"), userValidator);
    this.userDAO.init(logManager);

    class CacheDAO extends MongoCollectionReadWrite {}
    this.cacheDAO = new CacheDAO(DB.collection("cache"), () => true);
    this.cacheDAO.init(logManager);
  }

  async close() {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  /*
  ==============================================
  🔥 USER HELPERS
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
        loginAttempts: user?.twoFactor?.loginAttempts || 0,
        lockUntil: user?.twoFactor?.lockUntil || null,
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
    if (!user) throw new Error("USER_NOT_FOUND");

    if (!validatePassword(newPassword, PASSWORD_RULES)) {
      throw new Error("PASSWORD_WEAK");
    }

    const isSame = await bcrypt.compare(newPassword, user.passwordHash);
    if (isSame) throw new Error("PASSWORD_SAME");

    const passwordHash = await bcrypt.hash(newPassword, 12);

    return await this.updateUser(userId, {
      passwordHash,
      mustChangePassword: false,
    });
  }

  async createUser({ email, firstname, lastname }) {
    const normalizedEmail = email.trim();

    const existingUser = await this.userDAO.findOne({
      email: normalizedEmail,
    });

    const rawPassword = crypto.randomBytes(8).toString("base64");
    const cleanPassword = rawPassword.replace(/[+/=]/g, "A");

    const passwordHash = await bcrypt.hash(cleanPassword, 12);

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

    if (existingUser) {
      await this.updateUser(existingUser._id, updateData);
      return {
        userId: existingUser._id,
        initialPassword: cleanPassword,
        updated: true,
      };
    }

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
      created: true,
    };
  }

  async updateUser(id, updateObject) {
    return await this.userDAO.update(id, updateObject);
  }

  /*
  ==============================================
  BUSINESS LOGIC (UNVERÄNDERT)
  ==============================================
  */

  createUserTest(userId, name) {
    const test = new TestInfo();
    test.setId(new ObjectId());
    test.setUser(userId);
    test.setName(name);
    return this.testDAO.create(test);
  }

  async createTestAnswer(userId, test_id, question_id, answer_id, correct) {
    const answer = new TestAnswer();
    answer.setUser(userId);
    answer.setAnswer(answer_id);
    answer.setQuestion(question_id);
    answer.setTest(test_id);
    answer.setCorrect(correct);
    return this.testAnswersDAO.create(answer);
  }

  async getQuestion() {
    return await this.questionDAO.readNumber(1);
  }

  getAnswers(id) {
    return this.answerDAO.find({ ID: id });
  }

  async spec_getQuestionFull(id) {
    if (!ObjectId.isValid(id)) throw new Error("Invalid ObjectId");
    const aggregateObj = [
      { $match: { _id: new ObjectId(id) } },
      {
        $lookup: {
          from: "answer",
          let: { qid: { $toString: "$_id" } },
          pipeline: [{ $match: { $expr: { $eq: ["$question_id", "$$qid"] } } }],
          as: "answers",
        },
      },
    ];
    const result = await this.questionDAO.aggregate(aggregateObj);
    return result[0] || null;
  }

  async getQuestionsFullByIds(ids) {
    if (!Array.isArray(ids) || ids.length === 0) return [];
    const objectIds = ids.map((id) => new ObjectId(id));
    const aggregateObj = [
      { $match: { _id: { $in: objectIds } } },
      {
        $lookup: {
          from: "answer",
          let: { qid: { $toString: "$_id" } },
          pipeline: [{ $match: { $expr: { $eq: ["$question_id", "$$qid"] } } }],
          as: "answers",
        },
      },
      { $addFields: { sortIndex: { $indexOfArray: [objectIds, "$_id"] } } },
      { $sort: { sortIndex: 1 } },
    ];
    return await this.questionDAO.aggregate(aggregateObj);
  }

  async spec_getQuestionFullRandom(count) {
    return await this.questionDAO.collection
      .aggregate([
        { $sample: { size: count } },
        {
          $lookup: {
            from: "answer",
            let: { qid: { $toString: "$_id" } },
            pipeline: [
              { $match: { $expr: { $eq: ["$question_id", "$$qid"] } } },
            ],
            as: "answers",
          },
        },
      ])
      .toArray();
  }

  // --- Resultat & Performance Methoden ---

  async spec_calculateTestResult(id) {
    const testInfo = await this.testDAO.read(id);
    const answers = await this.testAnswersDAO.find({ test_id: id });
    let ok = 0,
      wrong = 0;
    answers.forEach((a) => (a.correct ? ok++ : wrong++));
    testInfo.correct = ok;
    testInfo.wrong = wrong;
    testInfo.answers = answers;
    await this.testDAO.update(testInfo._id, testInfo);
    return testInfo;
  }

  async spec_getTestFullById(testId) {
    const aggregateObj = [
      { $match: { _id: new ObjectId(testId) } },
      {
        $lookup: {
          from: "test_answers",
          let: { testIdStr: { $toString: "$_id" } },
          pipeline: [
            { $match: { $expr: { $eq: ["$test_id", "$$testIdStr"] } } },
            {
              $lookup: {
                from: "answer",
                let: { aId: { $toObjectId: "$answer_id" } },
                pipeline: [
                  { $match: { $expr: { $eq: ["$_id", "$$aId"] } } },
                  { $project: { text: 1 } },
                ],
                as: "userAnswer",
              },
            },
            { $addFields: { user: { $arrayElemAt: ["$userAnswer.text", 0] } } },
            {
              $lookup: {
                from: "question",
                let: { qId: { $toObjectId: "$question_id" } },
                pipeline: [
                  { $match: { $expr: { $eq: ["$_id", "$$qId"] } } },
                  {
                    $lookup: {
                      from: "answer",
                      let: { qIdStr: { $toString: "$_id" } },
                      pipeline: [
                        {
                          $match: {
                            $expr: { $eq: ["$question_id", "$$qIdStr"] },
                          },
                        },
                      ],
                      as: "answers",
                    },
                  },
                ],
                as: "question",
              },
            },
            { $addFields: { question: { $arrayElemAt: ["$question", 0] } } },
            { $addFields: { "question.user": "$user" } },
            { $project: { correct: 1, question: 1 } },
          ],
          as: "answers",
        },
      },
      {
        $addFields: {
          correctQuestions: {
            $map: {
              input: {
                $filter: {
                  input: "$answers",
                  cond: { $eq: ["$$this.correct", true] },
                },
              },
              as: "i",
              in: "$$i.question",
            },
          },
          wrongQuestions: {
            $map: {
              input: {
                $filter: {
                  input: "$answers",
                  cond: { $eq: ["$$this.correct", false] },
                },
              },
              as: "i",
              in: "$$i.question",
            },
          },
          totalQuestions: { $size: "$answers" },
        },
      },
    ];
    const result = await this.testDAO.aggregate(aggregateObj);
    return result[0] || null;
  }

  async spec_getPerformance(userId) {
    const aggregateObj = [
      { $match: { user_id: userId } },
      {
        $project: {
          date: "$_createdAt",
          testName: "$name",
          correct: 1,
          wrong: 1,
          totalQuestions: { $add: ["$correct", "$wrong"] },
        },
      },
      {
        $addFields: {
          percentage: {
            $cond: [
              { $eq: ["$totalQuestions", 0] },
              0,
              {
                $round: [
                  {
                    $multiply: [
                      { $divide: ["$correct", "$totalQuestions"] },
                      100,
                    ],
                  },
                  2,
                ],
              },
            ],
          },
        },
      },
      { $sort: { date: -1 } },
    ];
    return await this.testDAO.aggregate(aggregateObj);
  }

  // --- AI Tutor Methoden ---

  async spec_explain(questionId) {
    const instance = this;
    try {
      let explanation = "";

      const cacheRes = await instance.cacheDAO.findOne({ id: questionId });

      if (typeof cacheRes === "undefined" || cacheRes === null) {
        const aggregateObj = [
          { $match: { _id: new ObjectId(questionId) } },
          {
            $lookup: {
              from: "answer",
              let: { qIdStr: { $toString: "$_id" } },
              pipeline: [
                { $match: { $expr: { $eq: ["$question_id", "$$qIdStr"] } } },
              ],
              as: "answers",
            },
          },
          { $project: { _id: 1, question: 1, correct: 1, answers: 1 } },
        ];

        const res = await instance.questionDAO.aggregate(aggregateObj);
        if (!res || res.length === 0) return null;

        const qstObj = res[0];
        const answerArr = qstObj.answers.map((a) => a.text);
        const correctIdx = qstObj.answers.findIndex(
          (a) => a.answer.trim() === qstObj.correct.trim(),
        );

        explanation = await instance.#explain(
          qstObj.question,
          answerArr,
          correctIdx,
        );

        const cacheObj = {
          id: questionId,
          text: explanation,
          init: () => {},
        };

        await instance.cacheDAO.create(cacheObj);
      } else {
        explanation = cacheRes.text;
      }

      return explanation;
    } catch (error) {
      console.log(error);
    }
  }

  async spec_getAllUsers() {
    const users = await this.userDAO.readAll();
    return users.map((u) => this.normalizeUser(u));
  }

  async spec_deleteUser(userId) {
    const user = await this.userDAO.delete(userId);
    return this.normalizeUser(user);
  }


  async #_explain(question, answers, correctIdx) {
    const instance = this;

    try {
      const prompt = `
            You are a tutor. Please explain precise the following multiple choice question:
            Questions: "${question}"
            Options:
            0: ${answers[0]}
            1: ${answers[1]}
            2: ${answers[2]}
            3: ${answers[3]}

            The correct answer is option ${correctIdx}: "${answers[correctIdx]}".
            
            Your tasks:
            1. Explain, why the given answer is factual correct
            2. Explain, why the other options are wrong within this context. 

            Answer the question directly.

            Do NOT include:
            - introductions
            - meta commentary
            - phrases like "this is an excellent question"
            - any conversational filler

            Start immediately with structured Markdown content.

            Return ONLY valid Markdown.

            STRICT RULES:
            - Use ### for headings
            - Use * for bullet points
            - Use proper line breaks (\n)
            - Do NOT use numbers like "1." for headings
            - Do NOT use "." as bullet points
            - Do NOT include any introduction or explanation

            Start directly with the first heading.

            Example format:

            ### Title

            * Point 1
            * Point 2
            
            text that is **bold**

            text that is *italic*

            Be concise and factual.
        `;

      // ✅ Korrekter Aufruf für @google/generative-ai
      const result = await this.genAIModel.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (error) {
      this.logger.error("Gemini API error: " + error.message);
      return "Entschuldigung, die Erklärung konnte nicht generiert werden.";
    }
  }

  /**
   * AnythingLLM-Version
   * @param {*} question
   * @param {*} answers
   * @param {*} correctIdx
   * @returns
   */
  async #explain(question, answers, correctIdx) {
    try {
      const prompt = `
      You are a tutor. Please explain precise the following multiple choice question:
      Questions: "${question}"
      Options:
      0: ${answers[0]}
      1: ${answers[1]}
      2: ${answers[2]}
      3: ${answers[3]}

      The correct answer is option ${correctIdx}: "${answers[correctIdx]}".

      Your tasks:
      1. Explain, why the given answer is factual correct
      2. Explain, why the other options are wrong within this context. 

      Answer the question directly.

      Do NOT include:
      - introductions
      - meta commentary
      - phrases like "this is an excellent question"
      - any conversational filler

      Start immediately with structured Markdown content.

      Return ONLY valid Markdown.

      STRICT RULES:
      - Use ### for headings
      - Use * for bullet points
      - Use proper line breaks (\\n)
      - Do NOT use numbers like "1." for headings
      - Do NOT use "." as bullet points
      - Do NOT include any introduction or explanation

      Start directly with the first heading.

      Example format:

      ### Title

      * Point 1
      * Point 2

      text that is **bold**

      text that is *italic*

      Be concise and factual.
      `;

      const response = await fetch(
        "http://localhost:3001/api/v1/workspace/YOUR_WORKSPACE/chat",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer YOUR_API_KEY`,
          },
          body: JSON.stringify({
            message: prompt,
            mode: "chat",
          }),
        },
      );

      const data = await response.json();

      return data.textResponse || "Keine Antwort erhalten.";
    } catch (error) {
      console.error("AnythingLLM API error:", error.message);
      return "Entschuldigung, die Erklärung konnte nicht generiert werden.";
    }
  }
}

export default new MongoDatabase();
