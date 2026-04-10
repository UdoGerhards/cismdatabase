import bcrypt from "bcrypt";
import cors from "cors";
import crypto from "crypto";
import express from "express";
import rateLimit from "express-rate-limit";
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import QRCode from "qrcode";
import speakeasy from "speakeasy";
import MongoDatabase from "../database/MongoDatabase.js";
import Base from "../foundation/Base.js";
import LogManager from "../logging/LogManager.js";

import { JWT_SECRET, TOKEN_EXPIRATION } from "../../config.js";

/**
 * @class Server
 * @extends Base
 * @description Main server class that handles Express configuration, routing,
 * security middleware, and authentication logic.
 */
class Server extends Base {
  /**
   * @constructor
   * @param {string} db_name - The name of the database to connect to.
   * @param {string} connection - The database connection string.
   */
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

  /**
   * @method init
   * @async
   * @description Initializes the server by setting up logging, database connection, and registering routes.
   */
  async init() {
    super.init(LogManager);
    await this.db.init(LogManager);
    this.registerRoutes();
  }

  /**
   * @method listen
   * @param {number} port - The port number the server should listen on.
   * @returns {http.Server} The running HTTP server instance.
   */
  listen(port) {
    this.httpServer = this.app.listen(port, "127.0.0.1", () => {
      this.logger.info(`Server running on 127.0.0.1:${port}`);
      this.logRoutes();
    });
    return this.httpServer;
  }

  /**
   * @method close
   * @async
   * @description Closes the HTTP server and the database connection.
   */
  async close() {
    if (this.httpServer) {
      await new Promise((resolve) => this.httpServer.close(resolve));
      this.httpServer = null;
    }

    if (this.db?.close) {
      await this.db.close();
    }
  }

  /**
   * @method logRoutes
   * @description Iterates through the Express route stack and prints
   * all registered API endpoints to the console in a table format.
   */
  logRoutes() {
    // 1. Hole den Router-Stack sicher ab
    // Falls _router noch nicht da ist, versuchen wir ihn über den internen Handler zu triggern
    const stack = this.app._router?.stack || this.app.router?.stack || [];

    if (stack.length === 0) {
      this.logger.info(
        "Keine Routen im Stack gefunden oder Server noch im Startvorgang.",
      );
      return;
    }

    const routes = [];

    stack.forEach((middleware) => {
      if (middleware.route) {
        // Direkte Routen
        const methods = Object.keys(middleware.route.methods)
          .join(", ")
          .toUpperCase();
        routes.push({ Method: methods, Path: middleware.route.path });
      } else if (middleware.name === "router" && middleware.handle?.stack) {
        // Verschachtelte Router
        middleware.handle.stack.forEach((handler) => {
          if (handler.route) {
            const methods = Object.keys(handler.route.methods)
              .join(", ")
              .toUpperCase();
            routes.push({ Method: methods, Path: handler.route.path });
          }
        });
      }
    });

    if (routes.length > 0) {
      // Sortiere die Routen alphabetisch nach Pfad für bessere Übersicht
      routes.sort((a, b) => a.Path.localeCompare(b.Path));

      console.log("\n--- Verfügbare API-Routen ---");
      console.table(routes);
      console.log(`Gesamt: ${routes.length} Endpunkte\n`);
    }
  }

  /*
  ==============================================
  SECURITY HELPERS
  ==============================================
  */

  /**
   * @method encrypt
   * @param {string} text - The plain text to encrypt.
   * @returns {string} The encrypted text in the format "iv:ciphertext".
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

  /**
   * @method decrypt
   * @param {string} text - The encrypted text in "iv:ciphertext" format.
   * @returns {string} The decrypted plain text.
   */
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

  /**
   * @method authenticateJWT
   * @param {express.Request} req - Express request object.
   * @param {express.Response} res - Express response object.
   * @param {express.NextFunction} next - Express next middleware function.
   * @description Middleware to verify the JWT token provided in the Authorization header.
   */
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

  /**
   * @method isAdminUser
   * @param {express.Request} req - Express request object.
   * @param {express.Response} res - Express response object.
   * @param {express.NextFunction} next - Express next middleware function.
   * @description Middleware to check if the authenticated user has an 'admin' role.
   */
  isAdminUser(req, res, next) {
    if (!req.user || req.user.role !== "admin") {
      return res.status(403).json({ error: "Admin access required" });
    }
    next();
  }

  /**
   * @method isLocked
   * @param {Object} user - The user object from the database.
   * @returns {boolean} True if the user's account is currently locked due to too many login attempts.
   */
  isLocked(user) {
    return user.twoFactor?.lockUntil && user.twoFactor.lockUntil > Date.now();
  }

  /**
   * @method registerFailure
   * @param {Object} user - The user object.
   * @returns {Object} A MongoDB update object to increment login attempts
   * and potentially set a lock time.
   * @description Calculates the new login attempt count and lock status after a failed attempt.
   */
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

  /**
   * @method resetAttempts
   * @returns {Object} A MongoDB update object to reset login attempts and clear the lock.
   * @description Returns an object to reset the 2FA failure counters in the database.
   */
  resetAttempts() {
    return {
      "twoFactor.loginAttempts": 0,
      "twoFactor.lockUntil": null,
    };
  }

  /**
   * @method delay
   * @returns {Promise<void>}
   * @description Utility method to introduce a small artificial delay (300ms) to prevent brute-force attacks.
   */
  delay() {
    return new Promise((r) => setTimeout(r, 300));
  }

  /*
  ==============================================
  ROUTES
  ==============================================
  */

  /**
   * @method registerRoutes
   * @description Defines all API endpoints for the application, including user authentication,
   * admin management, 2FA setup, and business logic routes.
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

    instance.app.get(
      "/api/admin/questions/count",
      instance.authenticateJWT.bind(instance),
      instance.isAdminUser.bind(instance),
      async (req, res) => {
        try {
          // Nutzt die vorhandene countQuestions Methode deiner DB
          const count = await instance.db.spec_getTotalQuestionCount();

          res.json({
            success: true,
            count: count,
          });
        } catch (err) {
          instance.logger.error("Error fetching question count:", err);
          res
            .status(500)
            .json({ success: false, message: "Could not fetch count" });
        }
      },
    );

    /*
    instance.app.post(
      "/api/normalize/questions",
      // instance.adminLimiter,
      instance.authenticateJWT.bind(instance),
      instance.isAdminUser.bind(instance),
      async (req, res) => {
        // Timeout kann hier kürzer sein, da nur ein Chunk verarbeitet wird
        req.setTimeout(60000);

        try {
          // Das Frontend sendet nun chunkSize UND den aktuellen offset
          const { chunkSize, offset } = req.body;
          const size = parseInt(chunkSize) || 20;
          const startOffset = parseInt(offset) || 0;

          // 1. Fragen für diesen spezifischen Bereich aus DB holen
          const questions = await instance.db.spec_getQuestions(
            size,
            startOffset,
          );

          if (!questions || questions.length === 0) {
            return res.json({
              success: true,
              okCount: 0,
              wrongCount: 0,
              finished: true,
            });
          }

          // 2. Formatieren (Normalisieren)
          const normalized = normalizeQuestions(questions);

          // 3. KI-Verarbeitung & Datenbank-Update
          const cismResults =
            await instance.db.spec_processCismBatchWithAI(normalized);

          // 4. Antwort für diesen einen Chunk
          res.json({
            success: true,
            okCount: cismResults.success?.length || 0,
            wrongCount: cismResults.errors?.length || 0,
            finished: false,
          });

          instance.logger.debug(`Chunk at offset ${startOffset} finished.`);
        } catch (err) {
          instance.logger.error("CISM Chunk Processing failed:", err);
          res.status(500).json({
            success: false,
            message: "Error during chunk processing",
          });
        }
      },
    );
    */

    instance.app.get(
      "/api/admin/tests/full",
      instance.authenticateJWT.bind(instance),
      instance.isAdminUser.bind(instance), // Diese Middleware stellt sicher, dass nur Admins hier landen
      async (req, res) => {
        try {
          // 1. Daten aus dem Token extrahieren
          const { id: requestorId, role } = req.user;

          // 2. Das Flag aus dem Query-String auslesen
          const showAllRequested = req.query.showAll === "true";

          // 3. Logik: Nur wenn Rolle 'admin' UND showAll gewünscht ist, Filter auf null (alle)
          // Ansonsten (auch wenn ein Nicht-Admin das Flag schicken würde) filtern wir auf die eigene ID
          const targetId =
            role === "admin" && showAllRequested ? null : requestorId;

          instance.logger.info(
            `Request by ${role} (${requestorId}). showAll: ${showAllRequested} -> Target: ${targetId || "ALL"}`,
          );

          // 4. Datenbank-Aufruf
          const tests = await instance.db.spec_getAllTestsFull(targetId);

          res.json({
            success: true,
            data: tests,
            count: tests.length,
          });
        } catch (err) {
          instance.logger.error("Error fetching full test objects:", err);
          res.status(500).json({
            success: false,
            message: "Could not fetch full test objects",
          });
        }
      },
    );

    instance.app.delete(
      "/api/admin/tests/delete",
      instance.authenticateJWT.bind(instance),
      instance.isAdminUser.bind(instance), // Zugriffsschutz: Nur Admins
      async (req, res) => {
        try {
          // Extrahiere das Array der IDs aus dem Body
          const { testIds } = req.body;
          const { id: adminId } = req.user;

          // 1. Validierung
          if (!testIds || !Array.isArray(testIds) || testIds.length === 0) {
            return res.status(400).json({
              success: false,
              message: "No test IDs provided for deletion.",
            });
          }

          instance.logger.info(
            `Admin ${adminId} initiated DELETE for ${testIds.length} tests.`,
          );

          // 2. Datenbank-Aufruf (Löscht Tests und zugehörige Antworten)
          const result = await instance.db.spec_deleteTests(testIds);

          // 3. Erfolgsantwort
          res.json({
            success: true,
            message: "Deletion successful",
            deletedTests: result.deletedTests,
            deletedAnswers: result.deletedAnswers,
          });
        } catch (err) {
          instance.logger.error("Error during batch test deletion:", err);
          res.status(500).json({
            success: false,
            message: "An error occurred while deleting the tests.",
          });
        }
      },
    );

    instance.app.post("/validate-answers", async (req, res) => {
      try {
        // 2. Datenbank-Aufruf starten
        // Da der Prozess lange dauert, starten wir ihn asynchron (Promise ohne await)
        // Damit die HTTP-Verbindung nicht in einen Timeout läuft.
        instance.db
          .spec_processCismAnswerBatchWithAI()
          .then(() => {
            console.info(
              `AI Batch validation completed successfully for CISM answers.`,
            );
          })
          .catch((err) => {
            console.error("Error during background AI batch processing:", err);
          });

        // 3. Sofortige Erfolgsantwort (202 Accepted)
        res.status(202).json({
          success: true,
          message: "AI Batch processing started in background.",
          info: "You can monitor the progress in the system logs or the 'validated_answers' collection.",
        });
      } catch (err) {
        console.error("Error while starting the AI batch process:", err);
        res.status(500).json({
          success: false,
          message: "An error occurred while initiating the AI batch process.",
        });
      }
    });
  }
}

export default Server;
