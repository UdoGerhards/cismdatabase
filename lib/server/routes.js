// Server.js
import Base from "../foundation/Base.js";
import LogManager from "../logging/LogManager.js";
import MongoDatabase from "../database/MongoDatabase.js";
import express from "express";
import jwt from "jsonwebtoken";
import bodyParser from "body-parser";
import cors from "cors";
import { JWT_SECRET, TOKEN_EXPIRATION } from "../../config.js";

class Server extends Base {
  constructor(db_name, connection) {
    super();
    const instance = this;
    instance.db_name = db_name;
    instance.db_connection = connection;
    instance.app = express();
    instance.db = MongoDatabase;
    instance.app.use(express.json());
    instance.registerRoutes();
    instance.httpServer = null;
  }

  async init() {
    const instance = this;
    super.init(LogManager);
    await instance.db.init(LogManager);
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

  registerRoutes() {
    const instance = this;

    // /api/question
    instance.app.post("/api/question", async (req, res) => {
      instance.logger.info(
        "/api/question - Getting question object from database",
      );
      try {
        const question = await instance.db.getQuestion();
        instance.logger.debug(
          "Result from database: " + JSON.stringify(question),
        );
        res.json(question);
      } catch (err) {
        instance.logger.error(err);
        res.status(500).json({ error: "Failed to fetch requested" });
      }
    });

    // /api/get/test/for/period
    instance.app.post("/api/get/test/for/period", async (req, res) => {
      instance.logger.info(
        "/api/get/test/for/period - Getting test(s) for a given period",
      );
      try {
        const start_date = new Date(req.body.start_date);
        const end_date = new Date(req.body.end_date);

        instance.logger.debug(
          `Given period is start_date: ${start_date}, end_date: ${end_date}`,
        );
        const tests = await instance.db.spec_getTestResult(
          start_date,
          end_date,
        );
        instance.logger.debug(
          "Result from database: " + JSON.stringify(tests, null, 2),
        );
        res.json(tests);
      } catch (err) {
        instance.logger.error(err);
        res.status(500).json({ error: "Failed to fetch requested" });
      }
    });

    // /api/test/answer
    instance.app.post("/api/test/answer", async (req, res) => {
      const instance = this;
      instance.logger.info("/api/test/answer - Saving test answer to database");
      try {
        const { testId, questionId, answerId, correct } = req.body;
        if (!testId || !questionId || !answerId) {
          return res.status(400).json({ error: "Missing fields" });
        }
        await instance.db.createTestAnswer(
          testId,
          questionId,
          answerId,
          correct,
        );
        res.json({ ok: true });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to save answer" });
      }
    });

    // /api/test
    instance.app.post("/api/test", async (req, res) => {
      const instance = this;
      instance.logger.info("Creating new test");
      try {
        const { name } = req.body;
        instance.logger.debug("User name: " + name);
        const result = await instance.db.createUserTest(name);
        res.json(result);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to create test" });
      }
    });

    // /api/test/result
    instance.app.post("/api/test/result", async (req, res) => {
      const instance = this;
      try {
        const { id } = req.body;
        const result = await instance.db.spec_calculateTestResult(id);
        res.json(result);
      } catch (err) {
        instance.logger.error(err);
        res.status(500).json({ error: "Failed to calculate results" });
      }
    });

    // /api/user
    instance.app.post("/api/user", async (req, res) => {
      const instance = this;
      const clientCN = req.get("x-ssl-client-cn");

      instance.logger.info(`Authentication: ${clientCN}`);

      const match = clientCN.match(/emailAddress=([^,]+)/i);
      const found = match ? match[1] : null;
      const isEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(found);
      const email = isEmail ? found : null;

      if (email) {
        instance.logger.info(`Getting user information for: ${email}`);
        const user = await instance.db.getUser(email);
        instance.logger.debug(`Returning: ${user}`);

        if (typeof user === "object") {
          instance.logger.info(`User authenticated: ${user}`);

          console.log(JWT_SECRET);

          const token = jwt.sign(
            {
              id: user._id,
              firstname: user.firstname,
              lastname: user.lastname,
            },
            JWT_SECRET,
            {
              expiresIn: TOKEN_EXPIRATION,
            },
          );

          instance.logger.debug(`Token: ` + JSON.stringify(token, null, 2));

          res.json(token);
        } else {
          instance.logger.error("Unauthorized access!");
          res.status(401).json({ error: "Unauthorized access" });
        }
      } else {
        instance.logger.error("Unauthorized access!");
        res.status(401).json({ error: "Unauthorized access" });
      }
    });

    // --- Endpoint: Geschützte API ---
    app.get("/api/auth", (req, res) => {
      const authHeader = req.headers.authorization;
      if (!authHeader) return res.status(401).send();
      const token = authHeader.split(" ")[1];
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        res.json(decoded);
      } catch (e) {
        res.status(401).json({ message: "Token invalid or expired" });
      }
    });
  }
}

export default Server;
