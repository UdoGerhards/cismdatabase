// Server.js
import Base from "../foundation/Base.js";
import LogManager from "../logging/LogManager.js";

import Database from "../database/MongoDatabase.js";
import express from "express";

class Server extends Base {
  constructor(db_name, connection) {
    super();
    let instance = this;

    instance.db_name = db_name;
    instance.db_connection = connection;

    instance.app = express();
    instance.db = Database;

    instance.app.use(express.json());
    instance.registerRoutes();

    instance.httpServer = null; // wichtig!
  }

  async init() {
    let instance = this;
    super.init(LogManager);
    await instance.db.init(instance.db_connection, instance.db_name, LogManager);
  }

  listen(port) {
    let instance = this;
    instance.httpServer = instance.app.listen(port, "127.0.0.1", () => {
      console.log(`Server running on 127.0.0.1:${port}`);
    });
    return instance.httpServer;
  }

  async close() {
    let instance = this;

    if (instance.httpServer) {
      await new Promise((resolve) => instance.httpServer.close(resolve));
      instance.httpServer = null;
    }

    if (instance.db && instance.db.close) {
      await instance.db.close();
    }
  }

  registerRoutes() {
    let instance = this;


    /**
     * Gets a full question object from the database
     * 
     * @param {object} req
     * @param {object} res
     * 
     * @return {object}
     */
    instance.app.post("/api/question", async (req, res) => {

      instance.logger.info("/api/question - Getting question object from database");

      try {
        const question = await instance.db.getQuestion();

        instance.logger.debug("Result from database: "+JSON.stringify(question));

        res.json(question);
      } catch (err) {

        instance.logger.error(err);
        res.status(500).json({ error: "Failed to fetch requested" });
      }
    });

    /**
     * Get test for a given period of time 
     * 
     * @param {object} req 
     * @param {object} res 
     * 
     * @return {object}
     */

    instance.app.post("/api/get/test/for/period", async(req, res) => {

      instance.logger.info("/api/get/test/for/period - Getting test(s) for a given period")

      try {

          const start_date = req.body.start_date;
          const end_date = req.body.end_date;

          instance.logger.debug("Given period is start_data:"+ start_date +", end_data: "+end_date);

          const tests = await instance.db.spec_getTestResult(start_date, end_date);
          res.json(tests);

      } catch (err) {
        instance.logger.error(err);
        res.status(500).json({ error: "Failed to fetch requested" });
      }

    })

    instance.app.post("/api/answer", async (req, res) => {
      let instance = this;

      try {
        const { testId, questionId, answer } = req.body;
        if (!testId || !questionId || !answer) {
          return res.status(400).json({ error: "Missing fields" });
        }
        await instance.db.setGivenAnswer({ testId, questionId, answer });
        res.json({ ok: true });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to save answer" });
      }
    });

    instance.app.post("/api/test", async (req, res) => {
      let instance = this;
      try {
        const { name } = req.body;
        const result = await instance.db.createUserTest(name);
        res.json(result);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to create test" });
      }
    });

    instance.app.post("/api/test/results", async (req, res) => {
      let instance = this;
      try {
        const { id } = req.body;
        const result = await instance.db.calculateTestResult(id);
        res.json(result);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to calculate results" });
      }
    });

    instance.app.post("/api/user", async (req, res) => {
      let instance = this;
      try {
        const email = req.headers["x-client-email"];
        if (!email) return res.status(401).json({ error: "No client email" });

        const user = await instance.db.getUser(email);
        res.json(user || {});
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to fetch user" });
      }
    });
  }
}

export default Server;
