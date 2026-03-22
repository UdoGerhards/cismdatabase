// Server.js
import Base from "../foundation/Base.js";
import LogManager from "../logging/LogManager.js";
import MongoDatabase from "../database/MongoDatabase.js";
import express from "express";
import jwt from "jsonwebtoken";
import cors from "cors";
import { JWT_SECRET, TOKEN_EXPIRATION } from "../../config.js";
import { GoogleGenerativeAI } from "@google/generative-ai";

class Server extends Base {
  constructor(db_name, connection) {
    super();

    const instance = this;

    instance.db_name = db_name;
    instance.db_connection = connection;
    instance.app = express();
    instance.db = MongoDatabase;

    instance.app.use(cors());
    instance.app.use(express.json());

    instance.httpServer = null;
  }

  async init() {
    const instance = this;

    super.init(LogManager);
    await instance.db.init(LogManager);

    instance.registerRoutes();
  }

  listen(port) {
    const instance = this;

    instance.httpServer = instance.app.listen(port, "127.0.0.1", () => {
      instance.logger.info(`Server running on 127.0.0.1:${port}`);
    });

    return instance.httpServer;
  }

  async close() {
    const instance = this;

    if (instance.httpServer) {
      await new Promise((resolve) => instance.httpServer.close(resolve));
      instance.httpServer = null;
    }

    if (instance.db && instance.db.close) {
      await instance.db.close();
    }
  }

  /*
  ##############################################
  JWT AUTH MIDDLEWARE
  ##############################################
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
    } catch (err) {
      return res.status(401).json({ error: "Token invalid or expired" });
    }
  }

  /*
  ##############################################
  ROUTES
  ##############################################
  */

  registerRoutes() {
    const instance = this;

    /*
    ==============================================
    AUTHENTICATION VIA CLIENT CERTIFICATE
    ==============================================
    */

    instance.app.post("/api/user", async (req, res) => {
      const clientCN = req.get("x-ssl-client-cn");

      instance.logger.info(`Authentication certificate: ${clientCN}`);

      if (!clientCN) {
        return res.status(401).json({ error: "Client certificate missing" });
      }

      const match = clientCN.match(/emailAddress=([^,]+)/i);
      const email = match ? match[1] : null;

      if (!email) {
        return res
          .status(401)
          .json({ error: "Email not found in certificate" });
      }

      try {
        const user = await instance.db.getUser(email);

        if (!user) {
          return res.status(401).json({ error: "User not found" });
        }

        const token = jwt.sign(
          {
            id: user._id,
            firstname: user.firstname,
            lastname: user.lastname,
            email: email,
          },
          JWT_SECRET,
          {
            expiresIn: TOKEN_EXPIRATION,
          },
        );

        instance.logger.info(
          `User authenticated! ID: ${user._id}, Firstname: ${user.firstname}, Lastname: ${user.lastname}, E-Mail: ${user.email}`,
        );

        res.json({
          token,
          user: {
            id: user._id,
            firstname: user.firstname,
            lastname: user.lastname,
          },
        });
      } catch (err) {
        instance.logger.error(err);
        res.status(500).json({ error: "Authentication failed" });
      }
    });

    /*
    ==============================================
    TOKEN VALIDATION ENDPOINT
    ==============================================
    */

    instance.app.get(
      "/api/auth",
      instance.authenticateJWT.bind(instance),
      (req, res) => {
        res.json({
          authenticated: true,
          user: req.user,
        });
      },
    );

    /*
    ==============================================
    PROTECTED ROUTES
    ==============================================
    */

    instance.app.post(
      "/api/questions",
      instance.authenticateJWT.bind(instance),
      async (req, res) => {
        try {
          let { number } = req.body;
          number = Number(number);

          const questions =
            await instance.db.spec_getQuestionFullRandom(number);

          res.json(questions);
        } catch (err) {
          instance.logger.error(err);
          res.status(500).json({ error: "Failed to fetch question" });
        }
      },
    );

    instance.app.post(
      "/api/question",
      instance.authenticateJWT.bind(instance),
      async (req, res) => {
        try {
          const question = await instance.db.getQuestion();
          res.json(question);
        } catch (err) {
          instance.logger.error(err);
          res.status(500).json({ error: "Failed to fetch question" });
        }
      },
    );

    instance.app.post(
      "/api/get/test/for/period",
      instance.authenticateJWT.bind(instance),
      async (req, res) => {
        try {
          const start_date = new Date(req.body.start_date);
          const end_date = new Date(req.body.end_date);

          const tests = await instance.db.spec_getTestResult(
            start_date,
            end_date,
          );

          res.json(tests);
        } catch (err) {
          instance.logger.error(err);
          res.status(500).json({ error: "Failed to fetch requested" });
        }
      },
    );

    instance.app.post(
      "/api/test/answer",
      instance.authenticateJWT.bind(instance),
      async (req, res) => {
        try {
          const { userId, testId, questionId, answerId, correct } = req.body;

          if (!userId || !questionId || !answerId) {
            return res.status(400).json({ error: "Missing fields" });
          }

          await instance.db.createTestAnswer(
            userId,
            testId,
            questionId,
            answerId,
            correct,
          );

          res.json({ ok: true });
        } catch (err) {
          instance.logger.error(err);
          res.status(500).json({ error: "Failed to save answer" });
        }
      },
    );

    instance.app.post(
      "/api/test",
      instance.authenticateJWT.bind(instance),
      async (req, res) => {
        try {
          const { userId, name } = req.body;
          const result = await instance.db.createUserTest(userId, name);
          res.json(result);
        } catch (err) {
          instance.logger.error(err);
          res.status(500).json({ error: "Failed to create test" });
        }
      },
    );

    instance.app.post(
      "/api/test/questions",
      instance.authenticateJWT.bind(instance),
      async (req, res) => {
        try {
          const { ids } = req.body;
          const test = await instance.db.getQuestionsFullByIds(ids);
          res.json(test);
        } catch (err) {
          instance.logger.error(err);
          res.status(500).json({ error: "Failed to fetch question" });
        }
      },
    );

    instance.app.post(
      "/api/test/result",
      instance.authenticateJWT.bind(instance),
      async (req, res) => {
        try {
          const { id } = req.body;
          const result = await instance.db.spec_calculateTestResult(id);
          res.json(result);
        } catch (err) {
          instance.logger.error(err);
          res.status(500).json({ error: "Failed to calculate results" });
        }
      },
    );

    instance.app.post(
      "/api/test/performance",
      instance.authenticateJWT.bind(instance),
      async (req, res) => {
        try {
          const { id } = req.body;
          const result = await instance.db.spec_getPerformance(id);
          res.json(result);
        } catch (err) {
          instance.logger.error(err);
          res.status(500).json({ error: "Failed to get performance" });
        }
      },
    );

    instance.app.post(
      "/api/test/evaluation",
      instance.authenticateJWT.bind(instance),
      async (req, res) => {
        try {
          const { id } = req.body;
          const result = await instance.db.spec_getTestFullById(id);
          res.json(result);
        } catch (err) {
          instance.logger.error(err);
          res.status(500).json({ error: "Failed to get performance" });
        }
      },
    );

    instance.app.post(
      "/api/explain",
      instance.authenticateJWT.bind(instance),
      async (req, res) => {
        try {
          const { questionId } = req.body;
          const result = await instance.db.spec_explain(questionId);
          res.json(result);
        } catch (err) {
          instance.logger.error(err);
          res.status(500).json({ error: "Failed to communicate with AI!" });
        }
      },
    );

    /*
    ==============================================
    ROUTE DEBUG OUTPUT (FIX!)
    ==============================================
    */

    // WICHTIG: Express 5 nutzt router statt _router
    const router = instance.app._router || instance.app.router;

    if (router && router.stack) {
      router.stack.forEach((middleware) => {
        if (middleware.route) {
          const methods = Object.keys(middleware.route.methods)
            .join(", ")
            .toUpperCase();

          const path = middleware.route.path;

          instance.logger.info(`Route: ${methods} ${path}`);
        }
      });
    } else {
      instance.logger.warn("No router stack found (Express not initialized?)");
    }
  }
}

export default Server;
