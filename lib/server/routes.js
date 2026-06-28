import bcrypt from "bcrypt";
import cors from "cors";
import crypto from "crypto";
import express from "express";
import rateLimit from "express-rate-limit";
import session from "express-session"; // 💡 Korrigiert auf ESM Import
import jwt from "jsonwebtoken";
import { ObjectId } from "mongodb";
import QRCode from "qrcode";
import speakeasy from "speakeasy";
import MongoDatabase from "../database/MongoDatabase.js";
import Base from "../foundation/Base.js";
import LogManager from "../logging/LogManager.js";

import { JWT_SECRET, TOKEN_EXPIRATION } from "../../config.js";

// 🔐 Die von dir vorgegebenen Bitwerte für Rollen und Rechte
const PERM_USER = 1; // 0001 -> Normaler User
const PERM_CREATE_USERS = 2; // 0010 -> Kann User anlegen
const PERM_DELETE_USERS = 4; // 0100 -> Kann User löschen
const PERM_DELETE_TESTS = 8; // 1000 -> Kann Tests löschen
const PERM_KI_USE_ALLOWED = 16; // 10000 -> Kann explain benutzen
const PERM_ADMIN = 63; // 111111 -> Admin

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

    const instance = this;

    instance.db_name = db_name;
    instance.db_connection = connection;
    instance.app = express();
    instance.db = MongoDatabase;

    instance.app.set("trust proxy", 1);

    instance.app.use(cors());
    instance.app.use(express.json());

    // 💡 Korrigiert von 'instance.app.use' zu 'instance.app.use'
    instance.app.use(
      session({
        secret: "dein_sehr_geheimer_schluessel", // Ein zufälliger String zum Verschlüsseln der Session-ID
        resave: false, // Speichert die Session nur, wenn sie verändert wurde
        saveUninitialized: false, // Erzeugt erst eine Session, wenn wir Daten hineinschreiben
        cookie: {
          secure: false, // Auf 'true' setzen, wenn du HTTPS nutzt (wichtig für Produktion!)
          maxAge: 1000 * 60 * 60 * 2, // Gültigkeit des Cookies (hier: 2 Stunden)
        },
      }),
    );

    instance.httpServer = null;

    instance.ENCRYPTION_KEY = Buffer.from(process.env.ENCRYPTION_KEY);

    // 🔐 Rate Limits
    instance.loginLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 20,
      message: { error: "Too many requests. Try again later." },
    });

    instance.twoFALimiter = rateLimit({
      windowMs: 5 * 60 * 1000,
      max: 10,
      message: { error: "Too many 2FA attempts. Try again later." },
    });

    instance.adminLimiter = rateLimit({
      windowMs: 5 * 60 * 1000,
      max: 50,
    });

    instance.MAX_ATTEMPTS = 5;
    instance.LOCK_TIME = 5 * 60 * 1000;
  }

  /**
   * @method init
   * @async
   * @description Initializes the server by setting up logging, database connection, and registering routes.
   */
  async init() {
    super.init(LogManager);
    const instance = this;
    await instance.db.init(LogManager);
    instance.registerRoutes();
  }

  /**
   * @method listen
   * @param {number} port - The port number the server should listen on.
   * @returns {http.Server} The running HTTP server instance.
   */
  listen(port) {
    const instance = this;

    instance.httpServer = instance.app.listen(port, "127.0.0.1", () => {
      instance.logger.info(`Server running on 127.0.0.1:${port}`);
      instance.logRoutes();
    });
    return instance.httpServer;
  }

  /**
   * @method close
   * @async
   * @description Closes the HTTP server and the database connection.
   */
  async close() {
    const instance = this;

    if (instance.httpServer) {
      await new Promise((resolve) => instance.httpServer.close(resolve));
      instance.httpServer = null;
    }

    if (instance.db?.close) {
      await instance.db.close();
    }
  }

  /**
   * @method logRoutes
   * @description Iterates through the Express route stack and prints
   * all registered API endpoints to the console in a table format.
   */
  logRoutes() {
    const instance = this;

    const stack =
      instance.app._router?.stack || instance.app.router?.stack || [];

    if (stack.length === 0) {
      instance.logger.info(
        "Keine Routen im Stack gefunden oder Server noch im Startvorgang.",
      );
      return;
    }

    const routes = [];

    stack.forEach((middleware) => {
      if (middleware.route) {
        const methods = Object.keys(middleware.route.methods)
          .join(", ")
          .toUpperCase();
        routes.push({ Method: methods, Path: middleware.route.path });
      } else if (middleware.name === "router" && middleware.handle?.stack) {
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

  encrypt(text) {
    const instance = this;
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(
      "aes-256-cbc",
      instance.ENCRYPTION_KEY,
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
      instance.ENCRYPTION_KEY,
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
      req.userId = decoded.id;
      req.userRole =
        decoded.role !== undefined ? Number(decoded.role) : PERM_USER;
      next();
    } catch {
      return res.status(401).json({ error: "Token invalid or expired" });
    }
  }

  hasPermission(requiredPermission) {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({ error: "Unauthorized" });
      }

      const selectedRoleMask = Number(req.userRole);

      const checkPermission = (permission) => {
        if (permission === PERM_ADMIN) {
          return selectedRoleMask === PERM_ADMIN;
        }
        return (selectedRoleMask & permission) === permission;
      };

      const hasRight = Array.isArray(requiredPermission)
        ? requiredPermission.some((perm) => checkPermission(perm))
        : checkPermission(requiredPermission);

      if (!hasRight) {
        return res
          .status(403)
          .json({ error: "Forbidden: Insufficient permissions" });
      }

      next();
    };
  }

  isLocked(user) {
    return user.twoFactor?.lockUntil && user.twoFactor.lockUntil > Date.now();
  }

  registerFailure(user) {
    const attempts = (user.twoFactor?.loginAttempts || 0) + 1;

    const update = {
      "twoFactor.loginAttempts": attempts,
    };

    if (attempts >= instance.MAX_ATTEMPTS) {
      update["twoFactor.lockUntil"] = Date.now() + instance.LOCK_TIME;
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

      instance.logger.info(
        "--------------------------------------------------------------",
      );
      instance.logger.info(
        "Current user requested login: " + email + "/" + password,
      );
      instance.logger.info(
        "--------------------------------------------------------------",
      );

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

      instance.logger.debug("User is valid: " + valid);

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

        instance.logger.debug(
          "2FA is enabled, sending temp token for verification.",
          tempToken,
        );

        return res.json({
          requires2FA: true,
          tempToken,
        });
      }

      const currentRole =
        user.role !== undefined ? Number(user.role) : PERM_USER;

      const token = jwt.sign(
        {
          id: user._id,
          email: user.email,
          role: currentRole,
          type: "auth",
        },
        JWT_SECRET,
        { expiresIn: TOKEN_EXPIRATION },
      );

      const canDeleteTests = currentRole === PERM_ADMIN;

      let userObj = {
        token,
        user: {
          id: user._id,
          firstname: user.firstname,
          lastname: user.lastname,
          role: currentRole,
          canDeleteTests: canDeleteTests,
          twoFactor: { enabled: false },
          mustChangePassword: !!user.mustChangePassword,
        },
      };

      res.json(userObj);
    });

    /*
    ==============================================
    CREATE USER
    ==============================================
    */

    instance.app.post(
      "/api/maintain/user/new",
      instance.adminLimiter,
      instance.authenticateJWT.bind(instance),
      instance.hasPermission([PERM_CREATE_USERS, PERM_ADMIN]),
      async (req, res) => {
        const { firstname, lastname, email, password, role } = req.body;
        const userId = req.userId;

        if (!firstname || !lastname || !email || !password || !role) {
          return res.status(400).json({ error: "Missing fields" });
        }

        if (typeof email !== "string" || !email.includes("@")) {
          return res.status(400).json({ error: "Invalid email" });
        }

        instance.logger.debug(
          `Creating new user: ${firstname} ${lastname}, email: ${email}, role: ${role}`,
        );

        const result = await instance.db.createUser({
          firstname,
          lastname,
          email,
          password,
          role: role,
          userId: userId,
        });

        res.status(201).json(result);
      },
    );

    instance.app.delete(
      "/api/maintain/user/delete",
      instance.adminLimiter,
      instance.authenticateJWT.bind(instance),
      instance.hasPermission([PERM_DELETE_USERS, PERM_ADMIN]),
      async (req, res) => {
        try {
          const { userId } = req.body;

          if (req.userId === userId) {
            return res.status(400).json({ error: "Cannot delete yourself" });
          }

          if (!userId || !ObjectId.isValid(userId)) {
            return res.status(400).json({ error: "Invalid userId" });
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
      "/api/list/users",
      instance.adminLimiter,
      instance.authenticateJWT.bind(instance),
      instance.hasPermission([PERM_DELETE_USERS, PERM_ADMIN]),
      async (req, res) => {
        try {
          const users = await instance.db.spec_getAllUsers();

          const safeUsers = users.map((u) => {
            const uRole = u.role !== undefined ? Number(u.role) : PERM_USER;
            return {
              id: u._id,
              firstname: u.firstname,
              lastname: u.lastname,
              email: u.email,
              role: uRole,
              canDeleteTests:
                uRole === PERM_ADMIN || uRole === PERM_DELETE_TESTS,
              twoFactor: {
                enabled: !!u.twoFactor?.secret,
              },
            };
          });

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
      instance.hasPermission([PERM_USER]),
      async (req, res) => {
        const user = await instance.db.getUserById(req.userId);

        if (!user) {
          return res.status(401).json({ error: "Unauthorized user!!!" });
        }

        const currentRole =
          user.role !== undefined ? Number(user.role) : PERM_USER;

        res.json({
          user: {
            id: user._id,
            firstname: user.firstname,
            lastname: user.lastname,
            role: currentRole,
            canDeleteTests: currentRole === PERM_ADMIN,
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
      instance.hasPermission([PERM_USER]),
      async (req, res) => {
        try {
          await instance.db.changePassword(req.userId, req.body.newPassword);

          return res.json({ success: true });
        } catch (err) {
          if (err.message === "PASSWORD_SAME") {
            instance.logger.info(
              "Change password: User choosed the same password.",
            );
            return res.status(400).json({ error: "PASSWORD_SAME" });
          }

          if (err.message === "PASSWORD_WEAK") {
            instance.logger.info(
              "Change password: User choosed a weak password.",
            );
            return res.status(400).json({ error: "PASSWORD_WEAK" });
          }

          instance.logger.error("Change password: Internal server error.");
          instance.logger.debug(err);
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
      instance.hasPermission([PERM_USER]),
      async (req, res) => {
        const user = await instance.db.getUserById(req.userId);

        const entry = "CISM Trainer";

        const secret = speakeasy.generateSecret({
          name: entry,
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
      instance.hasPermission([PERM_USER]),
      async (req, res) => {
        const user = await instance.db.getUserById(req.userId);

        if (!user || !user.twoFactor || !user.twoFactor.tempSecret) {
          return res.status(400).json({
            error:
              "2FA-Setup wurde nicht initialisiert. Bitte QR-Code erneut scannen.",
          });
        }

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

        const user = await instance.db.getUserById(req.userId);

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

        const currentRole =
          user.role !== undefined ? Number(user.role) : PERM_USER;

        const token = jwt.sign(
          {
            id: user._id,
            email: user.email,
            type: "auth",
            role: currentRole,
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
            role: currentRole,
            canDeleteTests: currentRole === PERM_ADMIN,
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
      "/api/question",
      instance.authenticateJWT.bind(instance),
      instance.hasPermission([PERM_USER]),
      async (req, res) => {
        const number = 1;

        instance.logger.info(
          "Getting " + number + " questions for user " + req.userId,
        );

        if (!Array.isArray(req.session.viewedQuestionIds)) {
          instance.logger.debug(
            "Resetting viewedQuestionIds in session because it's not an array.",
          );
          req.session.viewedQuestionIds = [];
        }

        const { isTest } = req.body;
        if (!Array.isArray(req.session.includeDomains) || !isTest) {
          instance.logger.info(
            "Resetting includeDomains in session because it's not an array or isTest is false.",
          );

          req.session.includeDomains = [];
        }

        const excludeIds = req.session.viewedQuestionIds || [];
        const includeDomains = req.session.includeDomains || [];

        const domains = await instance.db.spec_getDistinctDomains();

        const questions = await instance.db.spec_getQuestionFullRandom(
          number,
          excludeIds,
          includeDomains,
        );

        if (questions && questions.length > 0) {
          const newId = questions[0]._id.toString();

          if (!req.session.viewedQuestionIds.includes(newId)) {
            req.session.viewedQuestionIds.push(newId);
          }
        }

        instance.logger.debug("Returning questions: ", questions);

        res.json(questions);
      },
    );

    instance.app.get(
      "/api/get/domains",
      instance.authenticateJWT.bind(instance),
      instance.hasPermission([PERM_USER]),
      async (req, res) => {
        const domains = await instance.db.spec_getDistinctDomains();

        instance.logger.debug(
          "Getting all domain names from database: ",
          domains,
        );

        res.json(domains);
      },
    );

    instance.app.post(
      "/api/set/domains",
      instance.authenticateJWT.bind(instance),
      instance.hasPermission([PERM_USER]),
      async (req, res) => {
        const { domains } = req.body;

        instance.logger.debug("Setting includeDomains in session: ", domains);

        if (!Array.isArray(domains)) {
          return res.status(400).json({ error: "Invalid input" });
        }

        req.session.includeDomains = domains;
        res.json({ ok: true });
      },
    );

    instance.app.post(
      "/api/test/answer",
      instance.authenticateJWT.bind(instance),
      instance.hasPermission([PERM_USER]),
      async (req, res) => {
        const { testId, questionId, answerId, correct } = req.body;

        if (!req.userId || !questionId || !answerId) {
          return res.status(400).json({ error: "Missing fields" });
        }

        if (typeof correct !== "boolean") {
          return res.status(400).json({ error: "Invalid input" });
        }

        await instance.db.createTestAnswer(
          req.userId,
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
      instance.hasPermission([PERM_USER]),
      async (req, res) => {
        const result = await instance.db.createUserTest(
          req.userId,
          req.body.name,
        );

        res.json(result);
      },
    );

    instance.app.post(
      "/api/test/result",
      instance.authenticateJWT.bind(instance),
      instance.hasPermission([PERM_USER]),
      async (req, res) => {
        if (!ObjectId.isValid(req.userId)) {
          return res.status(400).json({ error: "Invalid id" });
        }

        const testId = req.body.id;
        const result = await instance.db.spec_calculateTestResult(testId);

        res.json(result);
      },
    );

    instance.app.post(
      "/api/test/performance",
      instance.authenticateJWT.bind(instance),
      instance.hasPermission([PERM_USER]),
      async (req, res) => {
        if (!ObjectId.isValid(req.userId)) {
          return res.status(400).json({ error: "Invalid id" });
        }

        const result = await instance.db.spec_getPerformance(req.userId);
        res.json(result);
      },
    );

    instance.app.post(
      "/api/test/evaluation",
      instance.authenticateJWT.bind(instance),
      instance.hasPermission([PERM_USER]),
      async (req, res) => {
        if (!ObjectId.isValid(req.userId)) {
          return res.status(400).json({ error: "Invalid id" });
        }

        const testId = req.body.id;
        const result = await instance.db.spec_getTestFullById(testId);
        res.json(result);
      },
    );

    instance.app.post(
      "/api/explain",
      instance.authenticateJWT.bind(instance),
      instance.hasPermission([PERM_USER]),
      async (req, res) => {
        const result = await instance.db.spec_explain(req.body.questionId);
        res.json(result);
      },
    );

    instance.app.get(
      "/api/admin/questions/count",
      instance.authenticateJWT.bind(instance),
      instance.hasPermission([PERM_USER]),
      async (req, res) => {
        try {
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

    instance.app.get(
      "/api/admin/tests/full",
      instance.authenticateJWT.bind(instance),
      instance.hasPermission([PERM_USER]),
      async (req, res) => {
        try {
          const requestorId = req.userId;
          const roleMask = Number(req.userRole);
          const showAllRequested = req.query.showAll === "true";

          const isAdmin = (roleMask & PERM_ADMIN) === PERM_ADMIN;
          const targetId = isAdmin && showAllRequested ? null : requestorId;

          instance.logger.info(
            `Request by Mask ${roleMask} (${requestorId}). showAll: ${showAllRequested} -> Target: ${targetId || "ALL"}`,
          );

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
      "/api/maintain/tests/delete",
      instance.authenticateJWT.bind(instance),
      instance.hasPermission([PERM_DELETE_TESTS, PERM_ADMIN]),
      async (req, res) => {
        try {
          const { testIds } = req.body;

          if (!testIds || !Array.isArray(testIds) || testIds.length === 0) {
            return res.status(400).json({
              success: false,
              message: "No test IDs provided for deletion.",
            });
          }

          instance.logger.info(
            `Deleting tests with IDs: ${testIds.join(", ")} `,
          );

          const result = await instance.db.spec_deleteTests(testIds);

          res.json({
            success: result.success,
            message: result.message,
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

    instance.app.post(
      "/validate-answers",
      instance.hasPermission([PERM_USER]),
      async (req, res) => {
        try {
          instance.db
            .spec_processCismAnswerBatchWithAI()
            .then(() => {
              console.info(
                `AI Batch validation completed successfully for CISM answers.`,
              );
            })
            .catch((err) => {
              console.error(
                "Error during background AI batch processing:",
                err,
              );
            });

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
      },
    );
  }
}

export default Server;
