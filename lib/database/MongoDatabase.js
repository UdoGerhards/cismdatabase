import Base from "../foundation/Base.js";

import { DB_STRING, DB_NAME } from "../../config.js";
import MongoCollectionReadWrite from "../database/dao/MongoCollectionReadWrite.js";
import MongoCollectionReadOnly from "../database/dao/MongoCollectionReadOnly.js";

import TestInfo from "../database/model/TestInfo.js";

import { ObjectId, MongoClient } from "mongodb";
import "dotenv/config";

class MongoDatabase extends Base {
  /*
  testMeta = null;
  question = null;
  test = null;
  */

  constructor() {
    super();

    let instance = this;

    instance.questionDAO = null;
    instance.answerDAO = null;

    instance.testDAO = null;
    instance.testAnswersDAO = null;

    instance.userDAO = null
  }

  /**
   * Initialisiert die DB-Verbindung und alle Collections.
   * init() ist jetzt async und merged mit connect().
   */
  async init(dbString, dbName, logManager) {
    super.init(logManager);

    let instance = this;

    // Defaults übernehmen
    instance.dbConnectionString = dbString || DB_STRING;
    instance.dbName = dbName || DB_NAME;

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
      if (typeof info.name !== "string")
        throw new Error("Invalid name: expected string");
      if (typeof info.user !== "string")
        throw new Error("Invalid user: expected string");
      if (typeof info.correct !== "number")
        throw new Error("Invalid correct: expected number");
      if (typeof info.wrong !== "number")
        throw new Error("Invalid wrong: expected number");
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

      if (!testAnswer.test_id)
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
    return await instance.userCollection.findOne({ email: email.trim() });
  }

  createUserTest(name) {
    let instance = this;

    const test = new TestInfo();

    const _id = new ObjectId();
    test.setId(_id);
    test.init();
    test.setName(name);

    return instance.testDAO.create(test);
  }

  async getQuestion() {
    let instance = this;
    instance.logger.info("getQuestion: Getting random question ...");
    return await instance.questionDAO.readNumber(1);
  }

  getAnswers(id) {
    let instance = this;
    instance.logger.info("getAnswers: Getting question by id");
    return instance.answerDAO.find({ ID: id });
  }

  getRandomQuestions(count) {
    instance.logger.info(
      "getRandomQuestions: Getting '" + count + "' random messages",
    );
    let instance = this;
    return instance.questionDAO.readeNumber(count);
  }

  async spec_getTestResult(start, end) {
    let instance = this;
    instance.logger.info(
      "spec_getTestResult: Getting test results for period from " +
        start +
        " to " +
        end,
    );

    const aggregateObj = [
      {
        $match: {
          createdAT: { $gte: start, $lte: end },
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
    let instance = this;

    instance.logger.info(
      "getQuestionById: Getting question by given ID: " + id,
    );
    return await instance.question.findOne({ ID: id });
  }

  async spec_calculateTestResult(id) {
    let instance = this;
    instance.logger.info(
      "spec_calculateTestResult: Calculating test result for test with ID: " +
        id,
    );

    try {
      const testInfo = await instance.testDAO.read(id);

      const answers = await instance.testAnswersDAO.find({ test_id: id });

      let ok = 0;
      let wrong = 0;

      answers.forEach((answer) => {
        if (answer.correct) ok++;
        else wrong++;
      });

      testInfo.correct = ok;
      testInfo.wrong = wrong;

      await instance.testDAO.update(testInfo._id, testInfo);

      return testInfo;
    } catch (err) {
      throw new Error(err);
    }
  }

  async spec_getQuestionFull(id) {
    let instance = this;

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

  async spec_getQuestionFullRandom(count) {
    let instance = this;

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

    return result[0] || null;
  }
}

export default new MongoDatabase();
