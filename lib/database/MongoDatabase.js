import Base from "../foundation/Base.js";

import { DB_CONNECTION, DB_NAME, GEMINI_API_KEY } from "#config";
import MongoCollectionReadWrite from "../database/dao/MongoCollectionReadWrite.js";
import MongoCollectionReadOnly from "../database/dao/MongoCollectionReadOnly.js";

import TestInfo from "../database/model/TestInfo.js";
import TestAnswer from "../database/model/TestAnswer.js";

import { ObjectId, MongoClient } from "mongodb";
// ✅ Wechsel zum stabilen offiziellen Paket
import { GoogleGenerativeAI } from "@google/generative-ai";

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

  /**
   * Initialisiert die DB-Verbindung und das Gemini Modell.
   */
  async init(logManager) {
    super.init(logManager);

    let instance = this;

    // Defaults übernehmen
    instance.dbConnectionString = DB_CONNECTION;
    instance.dbName = DB_NAME;

    // ✅ Initialisierung Google AI (AI Studio)
    // Nutzt den Key direkt ohne Cloud-Credentials Zwang
    instance.genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

    // Wir nutzen gemini-1.5-flash für maximale Stabilität und Geschwindigkeit.
    // Falls du Gemini 2.0 nutzen willst, nimm "gemini-1.5-flash" -> "gemini-2.0-flash-exp"
    // und füge als zweiten Parameter { apiVersion: "v1beta" } hinzu.
    instance.genAIModel = instance.genAI.getGenerativeModel(
      {
        model: "gemini-2.5-flash",
      }
    );

    // Doppelverbindungen verhindern
    if (instance.client) {
      return;
    }

    // MongoClient erstellen + verbinden
    instance.client = new MongoClient(instance.dbConnectionString);
    await instance.client.connect();
    const DB = instance.client.db(instance.dbName);

    // -------------------------------
    // DAO's Initialisierung
    // -------------------------------

    const question = DB.collection("question");
    class QuestionDAO extends MongoCollectionReadOnly {}
    instance.questionDAO = new QuestionDAO(question);
    instance.questionDAO.init(logManager);

    const answer = DB.collection("answer");
    class AnswerDAO extends MongoCollectionReadOnly {}
    instance.answerDAO = new AnswerDAO(answer);
    instance.answerDAO.init(logManager);

    const testMetaValidator = (info) => {
      if (typeof info.name !== "string") throw new Error("Invalid name");
      if (typeof info.user_id !== "string") throw new Error("Invalid user");
      return true;
    };

    const test = DB.collection("test");
    class TestDAO extends MongoCollectionReadWrite {}
    instance.testDAO = new TestDAO(test, testMetaValidator);
    instance.testDAO.init(logManager);

    const testAnswerValidator = (testAnswer) => {
      if (!testAnswer) throw new Error("TestAnswer not defined!");
      return true;
    };

    const test_answers = DB.collection("test_answers");
    class TestAnswersDAO extends MongoCollectionReadWrite {}
    instance.testAnswersDAO = new TestAnswersDAO(
      test_answers,
      testAnswerValidator,
    );
    instance.testAnswersDAO.init(logManager);

    const user = DB.collection("user");
    class UserDAO extends MongoCollectionReadOnly {}
    instance.userDAO = new UserDAO(user);
    instance.userDAO.init(logManager);
  }

  async close() {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  // --- User & Test Core Methoden ---

  async getUser(email) {
    if (!email) return null;
    return await this.userDAO.findOne({ email: email.trim() });
  }

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

  // --- Abfrage Methoden ---

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

    // ✅ WICHTIG: await benutzen, da #explain asynchron ist
    return await instance.#explain(qstObj.question, answerArr, correctIdx);
  }

  async #explain(question, answers, correctIdx) {
    const instance = this;

    try {
      const prompt = `
            You are  a tutor. Please explain precise the following multiple choice question:
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
}

export default new MongoDatabase();
