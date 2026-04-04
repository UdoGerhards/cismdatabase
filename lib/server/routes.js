import Base from "../foundation/Base.js";
import LogManager from "../logging/LogManager.js";
import MongoDatabase from "../database/MongoDatabase.js";
import express from "express";
import jwt from "jsonwebtoken";
import cors from "cors";
import crypto from "crypto";
import speakeasy from "speakeasy";
import QRCode from "qrcode";
import bcrypt from "bcrypt";
import rateLimit from "express-rate-limit";
import { ObjectId } from "mongodb";

import { JWT_SECRET, TOKEN_EXPIRATION } from "../../config.js";

class Server extends Base {
  constructor(db_name, connection) {
    super();

    this.db_name = db_name;
    this.db_connection = connection;
    this.app = express();
    this.db = MongoDatabase;

    this.app.set("trust proxy", 1);

    this.app.use(cors());
    this.app.use(express.json());

    this.httpServer = null;

    this.ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY);

    // 🔐 Rate Limits
    this.loginLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 20,
      message: { error: "Too many requests. Try again later." },
    });

    this.twoFALimiter = rateLimit({
      windowMs: 5 * 60 * 1000,
      max: 10,
      message: { error: "Too many 2FA attempts. Try again later." },
    });

    this.adminLimiter = rateLimit({
      windowMs: 5 * 60 * 1000,
      max: 50,
    });

    this.MAX_ATTEMPTS = 5;
    this.LOCK_TIME = 5 * 60 * 1000;
  }

  async init() {
    super.init(LogManager);
    await this.db.init(LogManager);
    this.registerRoutes();
  }

  listen(port) {
    this.httpServer = this.app.listen(port, "127.0.0.1", () => {
      this.logger.info(`Server running on 127.0.0.1:${port}`);
    });
    return this.httpServer;
  }

  async close() {
    if (this.httpServer) {
      await new Promise((resolve) => this.httpServer.close(resolve));
      this.httpServer = null;
    }

    if (this.db?.close) {
      await this.db.close();
    }
  }

  /*
  ==============================================
  SECURITY HELPERS
  ==============================================
  */

  encrypt(text) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      "aes-256-cbc",
      this.ENCRYPTION_KEY,
      iv,
    );

    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");

    return iv.toString("hex") + ":" + encrypted;
  }

  decrypt(text) {
    const [ivHex, encrypted] = text.split(":");
    const iv = Buffer.from(ivHex, "hex");

    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      this.ENCRYPTION_KEY,
      iv,
    );

    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  }

  authenticateJWT(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({ error: "Missing Authorization header" });
    }

    const token = authHeader.split(" ")[1];

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = decoded;
      next();
    } catch {
      return res.status(401).json({ error: "Token invalid or expired" });
    }
  }

  isAdminUser(req, res, next) {

    console.log("Checking admin access for user:", req.user);

    if (!req.user || req.user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }
    next();
  }

  isLocked(user) {
    return user.twoFactor?.lockUntil && user.twoFactor.lockUntil > Date.now();
  }

  registerFailure(user) {
    const attempts = (user.twoFactor?.loginAttempts || 0) + 1;

    const update = {
      "twoFactor.loginAttempts": attempts,
    };

    if (attempts >= this.MAX_ATTEMPTS) {
      update["twoFactor.lockUntil"] = Date.now() + this.LOCK_TIME;
    }

    return update;
  }

  resetAttempts() {
    return {
      "twoFactor.loginAttempts": 0,
      "twoFactor.lockUntil": null,
    };
  }

  delay() {
    return new Promise((r) => setTimeout(r, 300));
  }

  /*
  ==============================================
  ROUTES
  ==============================================
  */

  registerRoutes() {
    const instance = this;

    /*
    ==============================================
    LOGIN (Password only)
    ==============================================
    */

    instance.app.post("/api/user", instance.loginLimiter, async (req, res) => {
      const { email, password } = req.body;

      if (
        typeof email !== "string" ||
        typeof password !== "string" ||
        email.length > 255 ||
        password.length > 255
      ) {
        return res.status(400).json({ error: "Invalid input" });
      }

      await instance.delay();

      if (!email || !password) {
        return res.status(400).json({ error: "Invalid credentials" });
      }

      const user = await instance.db.getUser(email);

      if (!user) {
        return res.status(401).json({ error: "Invalid credentials" });
      }

      if (instance.isLocked(user)) {
        return res.status(429).json({
          error: "Too many attempts. Try again later.",
        });
      }

      const valid = await bcrypt.compare(password, user.passwordHash);

      if (!valid) {
        const update = instance.registerFailure(user);
        await instance.db.updateUser(user._id.toString(), update);

        return res.status(401).json({ error: "Invalid credentials" });
      }

      await instance.db.updateUser(
        user._id.toString(),
        instance.resetAttempts(),
      );

      const is2FAEnabled = !!user.twoFactor?.secret;

      if (is2FAEnabled) {
        const tempToken = jwt.sign(
          {
            id: user._id,
            email: user.email,
            type: "2fa_pending",
          },
          JWT_SECRET,
          { expiresIn: "5m" },
        );

        return res.json({
          requires2FA: true,
          tempToken,
        });
      }

      const token = jwt.sign(
        {
          id: user._id,
          email: user.email,
          role: user.role,
          type: "auth",
        },
        JWT_SECRET,
        { expiresIn: TOKEN_EXPIRATION },
      );

      res.json({
        token,
        user: {
          id: user._id,
          firstname: user.firstname,
          lastname: user.lastname,
          role: user.role || null,
          twoFactor: { enabled: false },
          mustChangePassword: !!user.mustChangePassword,
        },
      });
    });

    /*
    ==============================================
    CREATE USER
    ==============================================
    */

    instance.app.post(
      "/api/admin/user",
      instance.adminLimiter,
      instance.authenticateJWT.bind(instance),
      instance.isAdminUser.bind(instance),
      async (req, res) => {
        const { firstname, lastname, email, password } = req.body;

        if (!firstname || !lastname || !email || !password) {
          return res.status(400).json({ error: "Missing fields" });
        }

        // optional stricter validation
        if (typeof email !== "string" || !email.includes("@")) {
          return res.status(400).json({ error: "Invalid email" });
        }

        const result = await instance.db.createUser({
          firstname,
          lastname,
          email,
          password,
          role: "user", // 🔒 niemals aus req.body übernehmen
        });

        res.status(201).json(result);
      },
    );

    instance.app.delete(
      "/api/delete/user",
      instance.adminLimiter,
      instance.authenticateJWT.bind(instance),
      instance.isAdminUser.bind(instance),
      async (req, res) => {
        try {
          const { userId } = req.body;

          if (req.user.id === userId) {
            return res.status(400).json({ error: "Cannot delete yourself" });
          }

          if (!userId || !ObjectId.isValid(userId)) {
            return res.status(400).json({ error: "Invalid userId" });
          }

          if (!userId) {
            return res.status(400).json({ error: "Missing userId" });
          }

          const user = await instance.db.getUserById(userId);

          if (!user) {
            return res.status(404).json({ error: "User not found" });
          }

          await instance.db.spec_deleteUser(userId);

          res.json({ success: true });
        } catch (err) {
          console.error(err);
          res.status(500).json({ error: "SERVER_ERROR" });
        }
      },
    );

    instance.app.get(
      "/api/list/all/users",
      instance.adminLimiter,
      instance.authenticateJWT.bind(instance),
      instance.isAdminUser.bind(instance),
      async (req, res) => {
        try {
          const users = await instance.db.spec_getAllUsers();

          const safeUsers = users.map((u) => ({
            id: u._id,
            firstname: u.firstname,
            lastname: u.lastname,
            email: u.email,
            role: u.role || null,
            twoFactor: {
              enabled: !!u.twoFactor?.secret,
            },
          }));

          res.json({ users: safeUsers });
        } catch (err) {
          console.error(err);
          res.status(500).json({ error: "SERVER_ERROR" });
        }
      },
    );

    /*
    ==============================================
    CURRENT USER
    ==============================================
    */

    instance.app.get(
      "/api/me",
      instance.authenticateJWT.bind(instance),
      async (req, res) => {
        const user = await instance.db.getUserById(req.user.id);

        if (!user) {
          return res.status(401).json({ error: "Unauthorized" });
        }

        console.log(user);

        res.json({
          user: {
            id: user._id,
            firstname: user.firstname,
            lastname: user.lastname,
            role: user.role || null,
            twoFactor: {
              enabled: !!user.twoFactor?.secret,
            },
            mustChangePassword: !!user.mustChangePassword,
          },
        });
      },
    );

    /*
    ==============================================
    CHANGE PASSWORD
    ==============================================
    */

    instance.app.post(
      "/api/user/change-password",
      instance.authenticateJWT.bind(instance),
      async (req, res) => {
        try {
          await instance.db.changePassword(req.user.id, req.body.newPassword);

          return res.json({ success: true });
        } catch (err) {
          if (err.message === "PASSWORD_SAME") {
            return res.status(400).json({ error: "PASSWORD_SAME" });
          }

          if (err.message === "PASSWORD_WEAK") {
            return res.status(400).json({ error: "PASSWORD_WEAK" });
          }

          return res.status(500).json({ error: "SERVER_ERROR" });
        }
      },
    );

    /*
    ==============================================
    2FA SETUP
    ==============================================
    */

    instance.app.post(
      "/api/2fa/setup",
      instance.authenticateJWT.bind(instance),
      async (req, res) => {
        const user = await instance.db.getUserById(req.user.id);

        const secret = speakeasy.generateSecret({
          name: "App",
          length: 20,
        });

        await instance.db.updateUser(user._id.toString(), {
          "twoFactor.tempSecret": instance.encrypt(secret.base32),
        });

        const qr = await QRCode.toDataURL(secret.otpauth_url);
        res.json({ qr });
      },
    );

    instance.app.post(
      "/api/2fa/verify-setup",
      instance.authenticateJWT.bind(instance),
      async (req, res) => {
        const user = await instance.db.getUserById(req.user.id);

        if (!/^\d{6}$/.test(req.body.token)) {
          return res.status(400).json({ error: "Invalid token format" });
        }

        const verified = speakeasy.totp.verify({
          secret: instance.decrypt(user.twoFactor.tempSecret),
          encoding: "base32",
          token: req.body.token,
        });

        if (!verified) {
          return res.json({ success: false });
        }

        await instance.db.updateUser(user._id.toString(), {
          "twoFactor.secret": user.twoFactor.tempSecret,
          "twoFactor.tempSecret": null,
        });

        res.json({ success: true });
      },
    );

    instance.app.post(
      "/api/2fa/verify",
      instance.twoFALimiter,
      instance.authenticateJWT.bind(instance),
      async (req, res) => {
        if (req.user.type !== "2fa_pending") {
          return res.status(403).json({ error: "Invalid token type" });
        }

        const user = await instance.db.getUserById(req.user.id);

        if (instance.isLocked(user)) {
          return res.status(429).json({
            error: "Too many attempts. Try again later.",
          });
        }

        const verified = speakeasy.totp.verify({
          secret: instance.decrypt(user.twoFactor.secret),
          encoding: "base32",
          token: req.body.token,
        });

        if (!verified) {
          await instance.db.updateUser(
            user._id.toString(),
            instance.registerFailure(user),
          );
          return res.json({ success: false });
        }

        await instance.db.updateUser(
          user._id.toString(),
          instance.resetAttempts(),
        );

        const token = jwt.sign(
          {
            id: user._id,
            email: user.email,
            type: "auth",
            role: user.role || null,
          },
          JWT_SECRET,
          { expiresIn: TOKEN_EXPIRATION },
        );

        res.json({
          success: true,
          token,
          user: {
            id: user._id,
            firstname: user.firstname,
            lastname: user.lastname,
            role: user.role || null,
            twoFactor: { enabled: true },
            mustChangePassword: !!user.mustChangePassword,
          },
        });
      },
    );

    /*
    ==============================================
    BUSINESS ROUTES
    ==============================================
    */

    instance.app.post(
      "/api/questions",
      instance.authenticateJWT.bind(instance),
      async (req, res) => {
        const number = Math.min(Math.max(parseInt(req.body.number), 1), 50);

        const questions = await instance.db.spec_getQuestionFullRandom(number);
        res.json(questions);
      },
    );

    instance.app.post(
      "/api/question",
      instance.authenticateJWT.bind(instance),
      async (req, res) => {
        const question = await instance.db.getQuestion();
        res.json(question);
      },
    );

    instance.app.post(
      "/api/test/answer",
      instance.authenticateJWT.bind(instance),
      async (req, res) => {
        const { userId, testId, questionId, answerId, correct } = req.body;

        if (!userId || !questionId || !answerId) {
          return res.status(400).json({ error: "Missing fields" });
        }

        if (typeof correct !== "boolean") {
          return res.status(400).json({ error: "Invalid input" });
        }

        await instance.db.createTestAnswer(
          userId,
          testId,
          questionId,
          answerId,
          correct,
        );

        res.json({ ok: true });
      },
    );

    instance.app.post(
      "/api/test",
      instance.authenticateJWT.bind(instance),
      async (req, res) => {
        const result = await instance.db.createUserTest(
          //req.body.userId,
          req.user.id,
          req.body.name,
        );
        res.json(result);
      },
    );

    instance.app.post(
      "/api/test/result",
      instance.authenticateJWT.bind(instance),
      async (req, res) => {
        if (!ObjectId.isValid(req.body.id)) {
          return res.status(400).json({ error: "Invalid id" });
        }

        const result = await instance.db.spec_calculateTestResult(req.body.id);
        res.json(result);
      },
    );

    instance.app.post(
      "/api/test/performance",
      instance.authenticateJWT.bind(instance),
      async (req, res) => {
        if (!ObjectId.isValid(req.body.id)) {
          return res.status(400).json({ error: "Invalid id" });
        }

        const result = await instance.db.spec_getPerformance(req.body.id);
        res.json(result);
      },
    );

    instance.app.post(
      "/api/test/evaluation",
      instance.authenticateJWT.bind(instance),
      async (req, res) => {
        if (!ObjectId.isValid(req.body.id)) {
          return res.status(400).json({ error: "Invalid id" });
        }

        const result = await instance.db.spec_getTestFullById(req.body.id);
        res.json(result);
      },
    );

    instance.app.post(
      "/api/explain",
      instance.authenticateJWT.bind(instance),
      async (req, res) => {
        const result = await instance.db.spec_explain(req.body.questionId);
        res.json(result);
      },
    );
  }
}

export default Server;
