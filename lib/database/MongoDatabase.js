const { DB_STRING, DB_NAME } = require("../../config");
const MongoCollectionReadWrite = require("../database/dao/MongoCollectionReadWrite");
const MongoCollectionReadOnly = require("../database/dao/MongoCollectionReadOnly");

const TestInfo = require("../database/model/TestInfo");

const { ObjectId } = require("mongodb");
const MongoClient = require("mongodb").MongoClient;
require("dotenv").config();

class MongoDatabase {
  testMeta = null;
  question = null;
  test = null;

  /**
   * Initialisiert die DB-Verbindung und alle Collections.
   * init() ist jetzt async und merged mit connect().
   */
  async init(dbString, dbName) {
    // Defaults übernehmen
    this.dbConnectionString = dbString || DB_STRING;
    this.dbName = dbName || DB_NAME;

    // Doppelverbindungen verhindern
    if (this.client) {
      return;
    }

    // MongoClient erstellen + verbinden
    this.client = new MongoClient(this.dbConnectionString);
    await this.client.connect();

    const DB = this.client.db(this.dbName);

    // -------------------------------
    // Validatoren
    // -------------------------------

    const testMetaValidator = (info) => {
      if (typeof info.name !== "string") throw new Error("Invalid name: expected string");
      if (typeof info.user !== "string") throw new Error("Invalid user: expected string");
      if (typeof info.correct !== "number") throw new Error("Invalid correct: expected number");
      if (typeof info.wrong !== "number") throw new Error("Invalid wrong: expected number");
      return true;
    };

    const testAnswerValidator = (testAnswer) => {
      if (!testAnswer) throw new Error("TestAnswer not defined!");
      if (typeof testAnswer !== "object") throw new Error("Invalid data type given");

      if (!testAnswer.test_id) throw new Error("Invalid test_id: expected ObjectId");
      if (!testAnswer.question_id) throw new Error("Invalid question_id: expected ObjectId");
      if (!testAnswer.answer_id) throw new Error("Invalid answer_id: expected ObjectId");
      if (typeof testAnswer.correct !== "boolean") throw new Error("Invalid correct: expected boolean");

      return true;
    };

    // -------------------------------
    // Collections
    // -------------------------------

    this.test = DB.collection("test");
    this.testMeta = new MongoCollectionReadWrite(this.test, testMetaValidator);

    const test_answers = DB.collection("test_answers");
    this.testAnswers = new MongoCollectionReadWrite(test_answers, testAnswerValidator);

    this.question = DB.collection("question");
    this.questionCollection = new MongoCollectionReadOnly(this.question);

    const answers = DB.collection("answer");
    this.answerCollection = new MongoCollectionReadOnly(answers);

    const user = DB.collection("user");
    this.userCollection = new MongoCollectionReadOnly(user);

    console.log("/*");
    console.log(" * Database initialized!");
    console.log(" */");
  }

  getDB() {
    return this.db;
  }

  async close() {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  // BUGFIX: this.user existierte nicht → jetzt userCollection
  async getUser(email) {
    if (!email) return null;
    return await this.userCollection.findOne({ email: email.trim() });
  }

  createUserTest(name) {
    const test = new TestInfo();

    const _id = new ObjectId();
    test.setId(_id);
    test.init();
    test.setName(name);

    return this.testMeta.create(test);
  }

  async getQuestion() {
    return await this.questionCollection.readNumber(1);
  }

  getAnswers(id) {
    return this.answerCollection.find({ ID: id });
  }

  getRandomQuestions(count) {
    return this.questionCollection.readeNumber(count);
  }

  async spec_getTestResult(start, end) {
    return this.test
      .aggregate([
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
      ])
      .toArray();
  }

  async getQuestionById(id) {
    return await this.question.findOne({ ID: id });
  }

  async spec_calculateTestResult(id) {
    try {
      const testInfo = await this.testMeta.read(id);

      const answers = await this.testAnswers.find({ test_id: id });

      let ok = 0;
      let wrong = 0;

      answers.forEach((answer) => {
        if (answer.correct) ok++;
        else wrong++;
      });

      testInfo.correct = ok;
      testInfo.wrong = wrong;

      await this.testMeta.update(testInfo._id, testInfo);

      return testInfo;
    } catch (err) {
      console.error("Fehler beim Berechnen des Testergebnisses:", err);
      throw new Error(err);
    }
  }

  async spec_getQuestionFull(id) {
    if (!ObjectId.isValid(id)) {
      throw new Error("Invalid ObjectId");
    }

    const _id = new ObjectId(id);

    const result = await this.question
      .aggregate([
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
      ])
      .toArray();

    return result[0] || null;
  }

  async spec_getQuestionFullRandom(count) {
    const result = await this.questionCollection.collection
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

module.exports = new MongoDatabase();
