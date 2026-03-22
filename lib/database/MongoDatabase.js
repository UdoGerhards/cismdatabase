import Base from "../foundation/Base.js";

import { DB_CONNECTION, DB_NAME, GEMINI_API_KEY } from "#config";
import MongoCollectionReadWrite from "../database/dao/MongoCollectionReadWrite.js";
import MongoCollectionReadOnly from "../database/dao/MongoCollectionReadOnly.js";

import TestInfo from "../database/model/TestInfo.js";
import TestAnswer from "../database/model/TestAnswer.js";

import { ObjectId, MongoClient } from "mongodb";
import { GoogleGenAI } from "@google/genai";

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
   * Initialisiert die DB-Verbindung und alle Collections.
   * init() ist jetzt async und merged mit connect().
   */
  async init(logManager) {
    super.init(logManager);

    let instance = this;

    // Defaults übernehmen
    instance.dbConnectionString = DB_CONNECTION;
    instance.dbName = DB_NAME;

    instance.genAI = new GoogleGenAI(GEMINI_API_KEY);

    // Doppelverbindungen verhindern
    if (instance.client) {
      return;
    }

    // MongoClient erstellen + verbinden
    instance.client = new MongoClient(instance.dbConnectionString);
    await instance.client.connect();
    const DB = instance.client.db(instance.dbName);

    // -------------------------------
    // DAO's
    // -------------------------------

    // question
    const question = DB.collection("question");
    class QuestionDAO extends MongoCollectionReadOnly {}
    instance.questionDAO = new QuestionDAO(question);
    instance.questionDAO.init(logManager);

    // answer
    const answer = DB.collection("answer");
    class AnswerDAO extends MongoCollectionReadOnly {}
    instance.answerDAO = new AnswerDAO(answer);
    instance.answerDAO.init(logManager);

    const testMetaValidator = (info) => {
      if (typeof info.name !== "string") {
        instance.logger.debug(`Type of name: ` + typeof info.name);
        throw new Error("Invalid name: expected string");
      }
      if (typeof info.user_id !== "string") {
        instance.logger.debug(`Type of user: ` + typeof info.user_id);
        throw new Error("Invalid user: expected string");
      }
      if (typeof info.correct !== "number") {
        instance.logger.debug(`Type of correct: ` + typeof info.correct);
        throw new Error("Invalid correct: expected number");
      }
      if (typeof info.wrong !== "number") {
        instance.logger.debug(`Type of wrong: ` + typeof info.wrong);
        throw new Error("Invalid wrong: expected number");
      }

      return true;
    };

    // test
    const test = DB.collection("test");
    class TestDAO extends MongoCollectionReadWrite {}
    instance.testDAO = new TestDAO(test, testMetaValidator);
    instance.testDAO.init(logManager);

    const testAnswerValidator = (testAnswer) => {
      if (!testAnswer) throw new Error("TestAnswer not defined!");
      if (typeof testAnswer !== "object")
        throw new Error("Invalid data type given");
      if (!testAnswer.user_id)
        throw new Error("Invalid test_id: expected ObjectId");
      if (!testAnswer.question_id)
        throw new Error("Invalid question_id: expected ObjectId");
      if (!testAnswer.answer_id)
        throw new Error("Invalid answer_id: expected ObjectId");
      if (typeof testAnswer.correct !== "boolean")
        throw new Error("Invalid correct: expected boolean");

      return true;
    };

    // test_answers
    const test_answers = DB.collection("test_answers");
    class TestAnswersDAO extends MongoCollectionReadWrite {}
    instance.testAnswersDAO = new TestAnswersDAO(
      test_answers,
      testAnswerValidator,
    );
    instance.testAnswersDAO.init(logManager);

    // user
    const user = DB.collection("user");
    class UserDAO extends MongoCollectionReadOnly {}
    instance.userDAO = new UserDAO(user);
    instance.userDAO.init(logManager);
  }

  getDB() {
    let instance = this;
    return instance.db;
  }

  async close() {
    let instance = this;
    if (instance.client) {
      await instance.client.close();
      instance.client = null;
    }
  }

  // BUGFIX: instance.user existierte nicht → jetzt userCollection
  async getUser(email) {
    let instance = this;
    if (!email) return null;
    return await instance.userDAO.findOne({ email: email.trim() });
  }

  createUserTest(userId, name) {
    let instance = this;

    instance.logger.info(
      "createUserTest: Creating a new user test in database ...",
    );

    instance.logger.debug(`User: ${userId}, Testname: ${name}`);
    instance.logger.debug(typeof userId);
    instance.logger.debug(typeof name);

    const test = new TestInfo();

    const _id = new ObjectId();
    test.setId(_id);
    test.setUser(userId);
    test.setName(name);

    return instance.testDAO.create(test);
  }

  async createTestAnswer(userId, test_id, question_id, answer_id, correct) {
    let instance = this;

    instance.logger.info(
      "createTestAnswer: Creating test answer object in database",
    );

    const answer = new TestAnswer();
    answer.setUser(userId);
    answer.setAnswer(answer_id);
    answer.setQuestion(question_id);
    answer.setTest(test_id);
    answer.setCorrect(correct);

    return instance.testAnswersDAO.create(answer);
  }

  async getQuestion() {
    const instance = this;
    instance.logger.info("getQuestion: Getting random question ...");
    return await instance.questionDAO.readNumber(1);
  }

  getAnswers(id) {
    const instance = this;
    instance.logger.info("getAnswers: Getting question by id");
    return instance.answerDAO.find({ ID: id });
  }

  getRandomQuestions(count) {
    const instance = this;
    instance.logger.info(
      "getRandomQuestions: Getting '" + count + "' random messages",
    );
    return instance.questionDAO.readeNumber(count);
  }

  async spec_getTestResult(start, end) {
    const instance = this;
    instance.logger.info(
      "spec_getTestResult: Getting test results for period from " +
        start +
        " to " +
        end,
    );

    const aggregateObj = [
      {
        $match: {
          _createdAt: { $gte: start, $lte: end },
        },
      },
      {
        $lookup: {
          from: "test_answers",
          let: { testIdStr: { $toString: "$_id" } },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$test_id", "$$testIdStr"] },
              },
            },
            {
              $lookup: {
                from: "question",
                let: { qid: "$question_id" },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $eq: ["$_id", { $toObjectId: "$$qid" }],
                      },
                    },
                  },
                  {
                    $lookup: {
                      from: "answer",
                      let: { qID: "$ID" },
                      pipeline: [
                        {
                          $match: {
                            $expr: { $eq: ["$question", "$$qID"] },
                          },
                        },
                        {
                          $project: {
                            _id: 0,
                            c: 1,
                            text: 1,
                          },
                        },
                      ],
                      as: "answers",
                    },
                  },
                  {
                    $addFields: {
                      correct_answer: {
                        $let: {
                          vars: {
                            match: {
                              $filter: {
                                input: "$answers",
                                cond: { $eq: ["$$this.c", "$correct"] },
                              },
                            },
                          },
                          in: { $arrayElemAt: ["$$match.text", 0] },
                        },
                      },
                    },
                  },
                  {
                    $project: {
                      _id: 0,
                      ID: 1,
                      question: 1,
                      correct: 1,
                      correct_answer: 1,
                      answers: 1,
                    },
                  },
                ],
                as: "question",
              },
            },
            {
              $unwind: {
                path: "$question",
                preserveNullAndEmptyArrays: true,
              },
            },
            {
              $lookup: {
                from: "answer",
                let: { aid: "$answer_id" },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $eq: ["$_id", { $toObjectId: "$$aid" }],
                      },
                    },
                  },
                  {
                    $project: {
                      _id: 0,
                      text: 1,
                    },
                  },
                ],
                as: "answer",
              },
            },
            {
              $unwind: {
                path: "$answer",
                preserveNullAndEmptyArrays: true,
              },
            },
            {
              $addFields: {
                user_answer: "$answer.text",
              },
            },
            {
              $project: {
                answer: 0,
              },
            },
          ],
          as: "answers",
        },
      },
    ];

    return await instance.testDAO.aggregate(aggregateObj);
  }

  async getQuestionById(id) {
    const instance = this;

    instance.logger.info(
      "getQuestionById: Getting question by given ID: " + id,
    );
    return await instance.question.findOne({ ID: id });
  }

  async spec_calculateTestResult(id) {
    const instance = this;
    instance.logger.info(
      "spec_calculateTestResult: Calculating test result for test with ID: " +
        id,
    );

    try {
      instance.logger.info(`Getting results for test with ${id}`);

      const testInfo = await instance.testDAO.read(id);

      instance.logger.debug(
        `Received from database ` + JSON.stringify(testInfo),
      );

      const answers = await instance.testAnswersDAO.find({ test_id: id });

      let ok = 0;
      let wrong = 0;

      answers.forEach((answer) => {
        if (answer.correct) ok++;
        else wrong++;
      });

      testInfo.correct = ok;
      testInfo.wrong = wrong;

      testInfo.answers = answers;

      await instance.testDAO.update(testInfo._id, testInfo);

      return testInfo;
    } catch (err) {
      throw new Error(err);
    }
  }

  async spec_getQuestionFull(id) {
    const instance = this;

    instance.logger.info(
      "spec_getQuestionFull: Getting the full question object for question with ID: " +
        id,
    );

    if (!ObjectId.isValid(id)) {
      throw new Error("Invalid ObjectId");
    }

    const _id = new ObjectId(id);

    const aggregateObj = [
      { $match: { _id } },
      {
        $lookup: {
          from: "answer",
          let: { qid: { $toString: "$_id" } },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$question_id", "$$qid"] },
              },
            },
          ],
          as: "answers",
        },
      },
    ];

    const result = await instance.questionDAO.aggregate(aggregateObj);

    return result[0] || null;
  }

  async getQuestionsFullByIds(ids) {
    const instance = this;

    instance.logger.info(
      "getQuestionsFullByIds: Getting questions for ids: " + ids.join(", "),
    );

    if (!Array.isArray(ids) || ids.length === 0) {
      return [];
    }

    // ✅ IDs validieren + konvertieren
    const objectIds = ids.map((id) => {
      if (!ObjectId.isValid(id)) {
        throw new Error("Invalid ObjectId: " + id);
      }
      return new ObjectId(id);
    });

    const aggregateObj = [
      {
        // 🔥 mehrere IDs matchen
        $match: {
          _id: { $in: objectIds },
        },
      },
      {
        // 🔗 answers join
        $lookup: {
          from: "answer",
          let: { qid: { $toString: "$_id" } },
          pipeline: [
            {
              $match: {
                $expr: { $eq: ["$question_id", "$$qid"] },
              },
            },
          ],
          as: "answers",
        },
      },
      {
        // 🧠 Reihenfolge Index hinzufügen
        $addFields: {
          sortIndex: {
            $indexOfArray: [objectIds, "$_id"],
          },
        },
      },
      {
        // 🔥 nach ursprünglicher Reihenfolge sortieren
        $sort: { sortIndex: 1 },
      },
    ];

    const result = await instance.questionDAO.aggregate(aggregateObj);

    return result;
  }

  async spec_getQuestionFullRandom(count) {
    const instance = this;

    instance.logger.info(
      "spec_getQuestionFullRandom: Getting '" +
        count +
        "' full random question objects!",
    );

    const result = await instance.questionDAO.collection
      .aggregate([
        { $sample: { size: count } },
        {
          $lookup: {
            from: "answer",
            let: { qid: { $toString: "$_id" } },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$question_id", "$$qid"] },
                },
              },
            ],
            as: "answers",
          },
        },
      ])
      .toArray();

    instance.logger.debug("Returning " + JSON.stringify(result));

    return result;
  }

  /**
   * Ergebnis von spec_getTestFullById(testId)
   *
   * @returns {Object|null}
   *
   * {
   *   _id: ObjectId,
   *   _createdAt: String,
   *   user_id: String,
   *   name: String,
   *   correct: Number,
   *   wrong: Number,
   *   id: String,
   *
   *   answers: [
   *     {
   *       _id: ObjectId,
   *       question_id: String,
   *       answer_id: String,
   *       correct: Boolean,
   *       _createdAt: Date,
   *
   *       question: {
   *         _id: ObjectId,
   *         ID: Number,
   *         question: String,
   *         correct: String, // z.B. "D"
   *
   *         CorrectAnswer: {
   *           _id: ObjectId,
   *           answer: String, // z.B. "D"
   *           text: String
   *         }
   *       }
   *     }
   *   ],
   *
   *   totalAnswers: Number,
   *   correctAnswers: Number,
   *   percentage: Number // 0 - 100
   * }
   *
   * // Falls kein Test gefunden wird:
   * null
   */
  async spec_getTestFullById(testId) {
    const instance = this;

    instance.logger.info(
      "spec_getTestFullById: Getting test with answers for id " + testId,
    );

    const aggregateObj = [
      {
        $match: {
          _id: new ObjectId(testId),
        },
      },
      {
        $lookup: {
          from: "test_answers",
          let: { testIdStr: { $toString: "$_id" } },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: ["$test_id", "$$testIdStr"],
                },
              },
            },

            // 🔥 User-Antwort (TEXT!) holen
            {
              $lookup: {
                from: "answer",
                let: {
                  aId: { $toObjectId: "$answer_id" },
                },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $eq: ["$_id", "$$aId"],
                      },
                    },
                  },
                  {
                    $project: {
                      _id: 1,
                      text: 1, // ✅ Antworttext
                    },
                  },
                ],
                as: "userAnswer",
              },
            },

            {
              $addFields: {
                user: {
                  $arrayElemAt: ["$userAnswer.text", 0],
                },
              },
            },

            // 🔗 question joinen
            {
              $lookup: {
                from: "question",
                let: {
                  qId: { $toObjectId: "$question_id" },
                },
                pipeline: [
                  {
                    $match: {
                      $expr: {
                        $eq: ["$_id", "$$qId"],
                      },
                    },
                  },

                  // 🔗 alle Antworten holen
                  {
                    $lookup: {
                      from: "answer",
                      let: {
                        qIdStr: { $toString: "$_id" },
                      },
                      pipeline: [
                        {
                          $match: {
                            $expr: {
                              $eq: ["$question_id", "$$qIdStr"],
                            },
                          },
                        },
                        {
                          $project: {
                            _id: 1,
                            answer: 1,
                            text: 1,
                          },
                        },
                      ],
                      as: "answers",
                    },
                  },

                  {
                    $project: {
                      _id: 1,
                      question: 1,
                      answers: 1,
                      correct: 1,
                    },
                  },
                ],
                as: "question",
              },
            },

            {
              $addFields: {
                question: { $arrayElemAt: ["$question", 0] },
              },
            },

            // 🔥 User-Antwort (TEXT) ins Question-Objekt
            {
              $addFields: {
                "question.user": "$user",
              },
            },

            {
              $project: {
                correct: 1,
                question: 1,
              },
            },
          ],
          as: "answers",
        },
      },

      // 📊 Struktur bauen
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
              as: "item",
              in: "$$item.question",
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
              as: "item",
              in: "$$item.question",
            },
          },
          totalQuestions: { $size: "$answers" },
        },
      },

      {
        $project: {
          _id: 1,
          correctQuestions: 1,
          wrongQuestions: 1,
          correct: 1,
          wrong: 1,
          totalQuestions: 1,
        },
      },
    ];

    const result = await instance.testDAO.aggregate(aggregateObj);

    instance.logger.debug("Aggregation result: " + JSON.stringify(result));

    return result[0] || null;
  }

  async spec_getPerformance(userId) {
    const instance = this;

    instance.logger.info(
      "spec_getPerformance: Getting performance for user: " + userId,
    );

    try {
      instance.logger.info(`Getting performance data for user ${userId}`);

      const aggregateObj = [
        {
          $match: {
            user_id: userId,
          },
        },
        {
          $project: {
            _id: 1,
            date: "$_createdAt",
            testName: "$name",
            correct: 1, // ✅ explizit drin
            wrong: 1, // ✅ explizit drin
            totalQuestions: { $add: ["$correct", "$wrong"] },
          },
        },
        {
          $addFields: {
            ratio: {
              $cond: [
                { $eq: ["$totalQuestions", 0] },
                0,
                { $divide: ["$correct", "$totalQuestions"] },
              ],
            },
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
        {
          $sort: { date: -1 },
        },
      ];

      const results = await instance.testDAO.aggregate(aggregateObj);

      instance.logger.debug(`Performance result: ` + JSON.stringify(results));

      return results;
    } catch (err) {
      //console.log(err);
      instance.logger.error("spec_getPerformance error: " + err.message);
      throw new Error(err);
    }
  }

  async spec_explain(questionId) {
    const instance = this;

    instance.logger.info(
      "spec_getQuestionFullById: Getting question with answers for id " +
        questionId,
    );

    const aggregateObj = [
      {
        // 🎯 Frage auswählen
        $match: {
          _id: new ObjectId(questionId),
        },
      },

      {
        // 🔗 Antworten joinen
        $lookup: {
          from: "answer",
          let: {
            qIdStr: { $toString: "$_id" }, // ObjectId → string
          },
          pipeline: [
            {
              $match: {
                $expr: {
                  $eq: ["$question_id", "$$qIdStr"],
                },
              },
            },
            {
              $project: {
                _id: 1,
                answer: 1,
                text: 1,
              },
            },
          ],
          as: "answers",
        },
      },

      {
        // 🎯 finales Format
        $project: {
          _id: 1,
          ID: 1,
          question: 1,
          correct: 1,
          answers: 1,
        },
      },
    ];

    const res = await instance.questionDAO.aggregate(aggregateObj);

    instance.logger.debug("Aggregation result: " + JSON.stringify(res));

    let explanation = {};

    let qstObj = {};
    if (res) {
      qstObj = res[0];

      let answerArr = new Array();

      let correctIdx = null;
      qstObj.answers.map((answer, idx) => {
        answerArr.push(answer.text);

        if (answer.answer.trim() === qstObj.correct.trim()) {
          correctIdx = idx;
        }
      });

      explanation = instance.#explain(qstObj.question, answerArr, correctIdx);
    }

    instance.logger.debug(
      "Received explanation: " + JSON.stringify(explanation),
    );

    return explanation;
  }

  async #explain(question, answers, correctIdx) {
    const instance = this;
    try {
      const prompt = `
            Du bist ein Tutor. Erkläre kurz und präzise folgende Multiple-Choice-Frage:
            Frage: "${question}"
            Optionen:
            0: ${answers[0]}
            1: ${answers[1]}
            2: ${answers[2]}
            3: ${answers[3]}

            Die richtige Antwort ist Option ${correctIdx}: "${answers[correctIdx]}".
            
            Deine Aufgabe:
            1. Erkläre kurz, warum diese Antwort fachlich korrekt ist.
            2. Erkläre kurz, warum die anderen Optionen in diesem Kontext falsch sind.
            Halte dich kurz (max. 150 Wörter).
        `;

      console.log(prompt);

      const result = await instance.genAI.models.generateContent({
        model: "gemini-2.0-flash",
        contents: prompt,
      });

      console.log(JSON.stringify(result, null, 3));

      const text = result.candidates[0].content.parts[0].text;
      
      console.log("KI Antwort:", text);

      return text;
    } catch (error) {
      console.log(error);

      instance.logger.error("Api error: " + JSON.stringify(error, null, 2));
      return null;
    }
  }
}

export default new MongoDatabase();
