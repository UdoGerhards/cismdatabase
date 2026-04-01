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

import { JWT_SECRET, TOKEN_EXPIRATION } from "../../config.js";

class Server extends Base {
  constructor(db_name, connection) {
    super();

    this.db_name = db_name;
    this.db_connection = connection;
    this.app = express();
    this.db = MongoDatabase;

    // 🔥 FIX
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

    // 🔒 Security Config
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

    if (this.db && this.db.close) {
      await this.db.close();
    }
  }

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

  // 🔒 Helper Functions
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

  async delay() {
    return new Promise((r) => setTimeout(r, 300));
  }

  registerRoutes() {
    const instance = this;

    /*
    ==============================================
    LOGIN
    ==============================================
    */

    instance.app.post("/api/user", instance.loginLimiter, async (req, res) => {
      const { email, password } = req.body;

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

      // ✅ Reset bei Erfolg
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
          twoFactor: { enabled: false },
          mustChangePassword: !!user.mustChangePassword,
        },
      });
    });

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
        const success = await instance.db.changePassword(
          req.user.id,
          req.body.newPassword,
        );

        res.json({ success });
      },
    );

    /*
    ==============================================
    CREATE USER
    ==============================================
    */

    instance.app.post("/api/admin/user", async (req, res) => {
      const result = await instance.db.createUser(req.body);
      res.status(201).json(result);
    });

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
          name: `CISMTrainer (${user.email})`,
          length: 20,
        });

        await instance.db.updateUser(user._id.toString(), {
          "twoFactor.tempSecret": instance.encrypt(secret.base32),
        });

        const qr = await QRCode.toDataURL(secret.otpauth_url);
        res.json({ qr });
      },
    );

    /*
    ==============================================
    2FA VERIFY SETUP
    ==============================================
    */

    instance.app.post(
      "/api/2fa/verify-setup",
      instance.authenticateJWT.bind(instance),
      async (req, res) => {
        const user = await instance.db.getUserById(req.user.id);

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

    /*
    ==============================================
    2FA VERIFY LOGIN
    ==============================================
    */

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
          const update = instance.registerFailure(user);
          await instance.db.updateUser(user._id.toString(), update);

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
            twoFactor: { enabled: true },
            mustChangePassword: !!user.mustChangePassword,
          },
        });
      },
    );
  }
}

export default Server;
