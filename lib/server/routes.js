import Base from "../foundation/Base.js";
import { DB_STRING, DB_NAME } from "../../config.js";

import Database from "../database/MongoDatabase.js";
import express from "express";

class Server extends Base {
  constructor() {

    super();

    this.app = express();
    this.db = Database;
    this.db.init(DB_STRING, DB_NAME);

    this.app.use(express.json());

    this.registerRoutes();
  }

  registerRoutes() {
    // Frage + Antworten
    this.app.post("/api/question", async (req, res) => {
      try {
        const question = await this.db.getQuestion();

        res.json(question);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch question" });
      }
    });

    // Antwort speichern
    this.app.post("/api/answer", async (req, res) => {
      try {
        const { testId, questionId, answer } = req.body;

        if (!testId || !questionId || !answer) {
          return res.status(400).json({ error: "Missing fields" });
        }

        await this.db.setGivenAnswer({
          testId,
          questionId,
          answer,
        });

        res.json({ ok: true });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to save answer" });
      }
    });

    // Test anlegen
    this.app.post("/api/test", async (req, res) => {
      try {
        const { name } = req.body;
        const result = await this.db.createUserTest(name);
        res.json(result);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to create test" });
      }
    });

    // Testergebnis berechnen
    this.app.post("/api/test/results", async (req, res) => {
      try {
        const { id } = req.body;
        const result = await this.db.calculateTestResult(id);
        res.json(result);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to calculate results" });
      }
    });

    // User aus mTLS (Nginx setzt Header)
    this.app.post("/api/user", async (req, res) => {
      try {
        const email = req.headers["x-client-email"];
        if (!email) return res.status(401).json({ error: "No client email" });

        const user = await this.db.getUser(email);
        res.json(user || {});
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch user" });
      }
    });
  }

  listen(port) {
    this.app.listen(port, "127.0.0.1", () => {
      console.log(`Server running on 127.0.0.1:${port}`);
    });
  }
}

export default new Server();
