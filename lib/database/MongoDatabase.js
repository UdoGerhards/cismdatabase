import Base from "../foundation/Base.js";

import { DB_CONNECTION, DB_NAME, GEMINI_API_KEY } from "#config";
import MongoCollectionReadOnly from "../database/dao/MongoCollectionReadOnly.js";
import MongoCollectionReadWrite from "../database/dao/MongoCollectionReadWrite.js";

import TestAnswer from "../database/model/TestAnswer.js";
import TestInfo from "../database/model/TestInfo.js";

import { GoogleGenerativeAI } from "@google/generative-ai";
import { MongoClient, ObjectId } from "mongodb";

import { PASSWORD_RULES } from "../../configuration/passwordRules.js";
import { validatePassword } from "../utils/validatePassword.js";

import bcrypt from "bcrypt";

import "dotenv/config";

/**
 * @class MongoDatabase
 * @extends Base
 * @description Manages the connection to MongoDB and provides Data Access Objects (DAOs)
 * for various collections, along with business logic for user management, tests,
 * and AI-driven explanations.
 */
class MongoDatabase extends Base {
  /**
   * @constructor
   * @description Initializes the MongoDatabase instance, setting up DAOs and AI models.
   */
  constructor() {
    super();

    /** @type {MongoCollectionReadOnly|null} */
    this.questionDAO = null;
    /** @type {MongoCollectionReadOnly|null} */
    this.answerDAO = null;
    /** @type {MongoCollectionReadWrite|null} */
    this.testDAO = null;
    /** @type {MongoCollectionReadWrite|null} */
    this.testAnswersDAO = null;
    /** @type {MongoCollectionReadWrite|null} */
    this.userDAO = null;
    /** @type {MongoCollectionReadWrite|null} */
    this.cacheDAO = null;
    /** @type {MongoCollectionReadWrite|null} */
    this.GeminiErrorDAO = null;
    /** @type {MongoCollectionReadWrite|null} */
    this.CISMResultsDAO = null;

    /** @type {GoogleGenerativeAI|null} */
    this.genAI = null;
    this.genAIModel = null;
    this.DB = null;
  }

  /**
   * @method init
   * @param {LogManager} logManager - The log manager instance for logging.
   * @description Initializes the database connection, Google Generative AI, and all DAOs.
   */
  async init(logManager) {
    const instance = this;
    super.init(logManager);

    instance.logger.debug(
      "Initializing MongoDatabase and connecting to: " + DB_CONNECTION,
    );
    instance.dbConnectionString = DB_CONNECTION;
    instance.dbName = DB_NAME;

    instance.logger.info(
      "Connecting to " +
        DB_CONNECTION +
        " and using database: " +
        DB_NAME +
        ".",
    );

    instance.genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    instance.genAIModel = instance.genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      //model: "gemini-1.5-flash-latest",
    });

    if (instance.client) return;

    instance.client = new MongoClient(instance.dbConnectionString);
    await instance.client.connect();
    instance.logger.debug("MongoDB connection established.");
    instance.DB = instance.client.db(instance.dbName);

    // ======================
    // DAOs
    // ======================

    class QuestionDAO extends MongoCollectionReadOnly {}
    instance.questionDAO = new QuestionDAO(instance.DB.collection("question"));
    instance.questionDAO.init(logManager);

    class AnswerDAO extends MongoCollectionReadOnly {}
    instance.answerDAO = new AnswerDAO(instance.DB.collection("answer"));
    instance.answerDAO.init(logManager);

    class TestDAO extends MongoCollectionReadWrite {}
    instance.testDAO = new TestDAO(instance.DB.collection("test"), (info) => {
      if (typeof info.name !== "string") throw new Error("Invalid name");
      if (typeof info.user_id !== "string") throw new Error("Invalid user");
      return true;
    });
    instance.testDAO.init(logManager);

    class TestAnswersDAO extends MongoCollectionReadWrite {}
    instance.testAnswersDAO = new TestAnswersDAO(
      instance.DB.collection("test_answers"),
      () => true,
    );

    instance.testAnswersDAO.init(logManager);

    // 🔥 USER VALIDATOR (gemerged)
    const userValidator = (user) => {
      if (!user) throw new Error("User not defined!");

      const hasDotNotation = Object.keys(user).some((k) => k.includes("."));
      if (hasDotNotation) return true;

      if (user.email && typeof user.email !== "string") {
        throw new Error("Invalid email");
      }

      if (user.twoFactor) {
        if (typeof user.twoFactor !== "object") {
          throw new Error("twoFactor must be object");
        }

        if (
          user.twoFactor.loginAttempts !== undefined &&
          typeof user.twoFactor.loginAttempts !== "number"
        ) {
          throw new Error("loginAttempts must be number");
        }

        if (
          user.twoFactor.lockUntil !== undefined &&
          user.twoFactor.lockUntil !== null &&
          !(user.twoFactor.lockUntil instanceof Date)
        ) {
          throw new Error("lockUntil must be Date");
        }
      }

      return true;
    };

    class UserDAO extends MongoCollectionReadWrite {}
    instance.userDAO = new UserDAO(
      instance.DB.collection("user"),
      userValidator,
    );
    instance.userDAO.init(logManager);

    class CacheDAO extends MongoCollectionReadWrite {}
    instance.cacheDAO = new CacheDAO(
      instance.DB.collection("cache"),
      () => true,
    );
    instance.cacheDAO.init(logManager);

    class GeminiErrorDAO extends MongoCollectionReadWrite {}
    instance.GeminiErrorDAO = new GeminiErrorDAO(
      instance.DB.collection("gemini_errors"),
    );
    instance.GeminiErrorDAO.init(logManager);

    class CISMResultsDAO extends MongoCollectionReadWrite {}
    instance.CISMResultsDAO = new CISMResultsDAO(
      instance.DB.collection("cism_results"),
    );
    instance.CISMResultsDAO.init(logManager);
    instance.logger.info("MongoDatabase initialized successfully.");
  }

  /**
   * @method close
   * @async
   * @description Closes the MongoDB client connection if it's open.
   */
  async close() {
    const instance = this;
    if (instance.client) {
      instance.logger.debug("Closing MongoDB client connection.");
      await instance.client.close();
      instance.client = null;
    }
  }

  /*
  ==============================================
  🔥 USER HELPERS
  ==============================================
  */

  /**
   * @method normalizeUser
   * @param {object} user - The raw user object from the database.
   * @returns {object|null} A normalized user object with default values for twoFactor fields,
   * or null if the input user is null.
   */
  normalizeUser(user) {
    const instance = this;
    if (!user) return null;

    return {
      ...user,
      twoFactor: {
        enabled: !!user?.twoFactor?.enabled,
        secret: user?.twoFactor?.secret || null,
        tempSecret: user?.twoFactor?.tempSecret || null,
        loginAttempts: user?.twoFactor?.loginAttempts || 0,
        lockUntil: user?.twoFactor?.lockUntil || null,
      },
      mustChangePassword: !!user.mustChangePassword,
    };
  }

  /**
   * @method updateUser
   * @async
   * @param {string} id - The ID of the user to update.
   * @param {object} updateObject - An object containing the fields to update.
   * @returns {Promise<object>} The updated user object.
   */
  async updateUser(id, updateObject) {
    const instance = this;
    instance.logger.debug("Updating user with ID: " + id);
    return await instance.userDAO.update(id, updateObject);
  }

  /**
   * @method getUser
   * @async
   * @param {string} email - The email of the user to retrieve.
   * @returns {Promise<object|null>} A normalized user object if found, otherwise null.
   */
  async getUser(email) {
    const instance = this;
    if (!email) return null;
    instance.logger.debug("Fetching user by email: " + email);
    const user = await instance.userDAO.findOne({ email: email.trim() });
    return instance.normalizeUser(user);
  }

  /**
   * @method getUserById
   * @async
   * @param {string} id - The ID of the user to retrieve.
   * @returns {Promise<object|null>} A normalized user object if found, otherwise null.
   */
  async getUserById(id) {
    const instance = this;
    if (!id) return null;
    instance.logger.debug("Fetching user by ID: " + id);
    const user = await instance.userDAO.findOne({ _id: new ObjectId(id) });
    return instance.normalizeUser(user);
  }

  /**
   * @method changePassword
   * @async
   * @param {string} userId - The ID of the user whose password is to be changed.
   * @param {string} newPassword - The new password for the user.
   * @returns {Promise<object>} The updated user object.
   * @throws {Error} If the user is not found, the password is weak, or the new password is the same as the old one.
   */
  async changePassword(userId, newPassword) {
    const instance = this;
    const user = await instance.getUserById(userId);

    instance.logger.debug("Changing password for user: " + userId);
    if (!user) throw new Error("USER_NOT_FOUND");

    if (!validatePassword(newPassword, PASSWORD_RULES)) {
      throw new Error("PASSWORD_WEAK");
    }

    const isSame = await bcrypt.compare(newPassword, user.passwordHash); // bcrypt.compare does not use 'this'
    if (isSame) throw new Error("PASSWORD_SAME");

    const passwordHash = await bcrypt.hash(newPassword, 12);

    instance.logger.info("Password successfully changed for user: " + userId);

    return await instance.updateUser(userId, {
      passwordHash,
      mustChangePassword: false,
    });
  }

  /**
   * @method createUser
   * @async
   * @param {object} userDetails - An object containing user details.
   * @param {string} userDetails.email - The email of the new user.
   * @param {string} userDetails.firstname - The first name of the new user.
   * @param {string} userDetails.lastname - The last name of the new user.
   * @returns {Promise<object>} An object containing the userId and the initial password.
   */
  async createUser({ email, firstname, lastname, password, role, userId }) {
    const instance = this;
    const normalizedEmail = email.trim();

    // 1. Prüfen, ob der User bereits existiert
    const existingUser = await instance.userDAO.findOne({
      email: normalizedEmail,
    });

    instance.logger.debug(
      "Creating or updating user account for: " + normalizedEmail,
    );

    instance.logger.debug(
      `${userId}Creating new user: ${firstname} ${lastname}, email: ${email}, role: ${role}`,
    );

    // 2. Das vom Admin übergebene Passworthashen (statt Zufallspasswort)
    const passwordHash = await bcrypt.hash(password, 12);

    // Basis-Daten für Update oder Create
    const updateData = {
      passwordHash,
      mustChangePassword: true, // Kann auf false gesetzt werden, wenn der Admin das Passwort bestimmt
      twoFactor: {
        enabled: false,
        secret: null,
        tempSecret: null,
        loginAttempts: 0,
        lockUntil: null,
      },
      // Hier fügen wir die neuen Felder hinzu, falls sie bei einem Update überschrieben werden sollen
      firstname,
      lastname,
      role,
      token: null,
      createdAt: new Date(),
      createdByUser: new ObjectId(userId),
    };

    // 3. FALL: User existiert bereits -> Update
    if (existingUser) {
      await instance.updateUser(existingUser._id, updateData);
      instance.logger.info("User account updated for: " + normalizedEmail);

      return {
        userId: existingUser._id,
        updated: true,
      };
    }

    // 4. FALL: User existiert nicht -> Neu anlegen
    const user = {
      email: normalizedEmail,
      ...updateData,
      createdAt: new Date(),
      init() {},
    };

    const createdUser = await instance.userDAO.create(user);

    instance.logger.info("New user account created: " + normalizedEmail);

    return {
      userId: createdUser?._id,
      created: true,
    };
  }

  /*
  ==============================================
  ❓ QUESTION ACCESS
  ==============================================
  */

  /**
   * @method getQuestion
   * @async
   * @returns {Promise<object>} A single random question object.
   * @description Retrieves a single random question from the database.
   */
  async getQuestion() {
    const instance = this;
    return await instance.questionDAO.readNumber(1);
  } // No 'this' to replace

  /**
   * @method getAnswers
   * @param {string} id - The ID of the question to get answers for.
   * @returns {Promise<Array<object>>} An array of answer objects for the given question ID.
   */
  getAnswers(id) {
    const instance = this;
    return instance.answerDAO.find({ ID: id });
  }

  /**
   * @method spec_getQuestionFull
   * @async
   * @param {string} id - The ID of the question to retrieve.
   * @returns {Promise<object|null>} A full question object including its answers, or null if not found.
   */
  async spec_getQuestionFull(id) {
    const instance = this;
    if (!ObjectId.isValid(id)) throw new Error("Invalid ObjectId");
    instance.logger.debug(
      "Fetching full question data (with answers) for: " + id,
    );
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
    const result = await instance.questionDAO.aggregate(aggregateObj);
    return result[0] || null;
  }

  /**
   * @method getQuestionsFullByIds
   * @async
   * @param {Array<string>} ids - An array of question IDs to retrieve.
   * @returns {Promise<Array<object>>} An array of full question objects including their answers.
   */
  async getQuestionsFullByIds(ids) {
    const instance = this;
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
    return await instance.questionDAO.aggregate(aggregateObj);
  }

  /**
   * @method spec_getQuestionFullRandom
   * @async
   * @param {number} count - The number of random questions to retrieve.
   * @param {Array<ObjectId|string>} [excludeIds=[]] - Array of ObjectIds to exclude.
   * @param {Array<string>} [includeDomains=[]] - Array of domain names to include.
   * @returns {Promise<Array<object>>} An array of random full question objects including their answers.
   */
  async spec_getQuestionFullRandom(
    count,
    excludeIds = [],
    includeDomains = [],
  ) {
    const instance = this;

    instance.logger.debug(`Fetching ${count} random questions.`);

    // 1. Dynamischen Match-Filter aufbauen
    const matchFilter = {};

    // IDs ausschließen, falls das Array nicht leer ist
    if (excludeIds.length > 0) {
      matchFilter._id = { $nin: excludeIds };
    }

    // Domains einschränken, falls das Array nicht leer ist
    if (includeDomains.length > 0) {
      matchFilter.domain = { $in: includeDomains };
    }

    // 2. Aggregations-Pipeline definieren
    const pipeline = [];

    // Nur wenn mindestens ein Filter aktiv ist, fügen wir $match hinzu
    if (Object.keys(matchFilter).length > 0) {
      pipeline.push({ $match: matchFilter });
    }

    // Die restlichen Stufen wie gehabt hinzufügen
    pipeline.push(
      { $sample: { size: count } },
      {
        $lookup: {
          from: "answer",
          localField: "_id",
          foreignField: "question_id",
          as: "answers",
        },
      },
    );

    return await instance.questionDAO.collection.aggregate(pipeline).toArray();
  }

  /*
  ==============================================
  📝 TEST EXECUTION & RESULTS
  ==============================================
  */

  /**
   * @method createUserTest
   * @param {string} userId - The ID of the user creating the test.
   * @param {string} name - The name of the test.
   * @returns {Promise<object>} The newly created test object.
   * @description Creates a new test entry in the database for a given user.
   */
  createUserTest(userId, name) {
    const instance = this;
    const test = new TestInfo();
    test.setId(new ObjectId());
    test.setUser(userId);
    test.setName(name);
    instance.logger.debug(
      "Creating new user test: " + name + " for user: " + userId,
    );
    return instance.testDAO.create(test);
  }

  /**
   * @method createTestAnswer
   * @async
   * @param {string} userId - The ID of the user who answered.
   * @param {string} test_id - The ID of the test.
   * @param {string} question_id - The ID of the question.
   * @param {string} answer_id - The ID of the chosen answer.
   * @param {boolean} correct - Indicates if the answer was correct.
   * @returns {Promise<object>} The newly created test answer object.
   */
  async createTestAnswer(userId, test_id, question_id, answer_id, correct) {
    const instance = this;
    const answer = new TestAnswer();
    answer.setUser(userId);
    answer.setAnswer(answer_id);
    answer.setQuestion(question_id);
    answer.setTest(test_id);
    answer.setCorrect(correct);
    return instance.testAnswersDAO.create(answer);
  }

  /**
   * @method spec_calculateTestResult
   * @async
   * @param {string} id - The ID of the test to calculate results for.
   * @returns {Promise<object>} The updated test information object with calculated correct/wrong answers.
   */
  async spec_calculateTestResult(id) {
    const instance = this;
    instance.logger.debug("Calculating results for test: " + id);

    const testInfo = await instance.testDAO.read(id);
    const answers = await instance.testAnswersDAO.find({ test_id: id });

    let ok = 0;
    let wrong = 0;
    const domains = {};

    // FOR...OF Schleife erlaubt die korrekte Verwendung von await
    for (const a of answers) {
      a.correct ? ok++ : wrong++;

      const question = await instance.questionDAO.getById(
        new ObjectId(a.question_id),
      );

      if (question && question.domain) {
        const dom = question.domain;

        // Korrekte Initialisierung des Domain-Objekts, falls noch nicht vorhanden
        if (domains[dom] === undefined) {
          domains[dom] = { ok: 0, wrong: 0 };
        }

        // Korrekte Hochzählung im Objekt
        a.correct ? domains[dom].ok++ : domains[dom].wrong++;
      }
    }

    testInfo.correct = ok;
    testInfo.wrong = wrong;
    testInfo.answers = answers;
    testInfo.domains = domains;

    await instance.testDAO.update(testInfo._id, testInfo);
    instance.logger.info(
      `Results calculated for test ${id}: ${ok} correct, ${wrong} wrong.`,
    );
    return testInfo;
  }

  /**
   * @method spec_getTestFullById
   * @async
   * @param {string} testId - The ID of the test to retrieve.
   * @returns {Promise<object|null>} A full test object including all questions, user answers, and correctness, or null if not found.
   */
  async spec_getTestFullById(testId) {
    const instance = this;
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
                      let: { qId: "$_id" }, // Hier die ObjectId der Frage nehmen
                      pipeline: [
                        {
                          $match: {
                            $expr: { $eq: ["$question_id", "$$qId"] }, // Vergleich ObjectId mit ObjectId
                          },
                        },
                      ],
                      as: "answers", // Hier werden nun die Antwortmöglichkeiten geladen
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

    const result = await instance.testDAO.aggregate(aggregateObj);
    return result[0] || null;
  }

  /**
   * @method spec_getAllTestsFull
   * @async
   * @param {string|null} [userId=null] - Optional. The ID of the user to filter tests by. If null, all tests are returned.
   * @returns {Promise<Array<object>>} An array of grouped test objects by user_id.
   */
  async spec_getAllTestsFull(userId = null) {
    const instance = this;
    // Initialer Filter: Wenn userId vorhanden, filtere danach, sonst nimm alle Dokumente
    const matchQuery = userId ? { user_id: userId } : {};

    const aggregateObj = [
      { $match: matchQuery },
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
          as: "fullAnswers",
        },
      },
      {
        $addFields: {
          correctQuestions: {
            $map: {
              input: {
                $filter: {
                  input: "$fullAnswers",
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
                  input: "$fullAnswers",
                  cond: { $eq: ["$$this.correct", false] },
                },
              },
              as: "i",
              in: "$$i.question",
            },
          },
          totalQuestions: { $size: "$fullAnswers" },
        },
      },
      // Das temporäre Feld entfernen, bevor wir gruppieren
      { $project: { fullAnswers: 0 } },

      // --- NEU: Gruppierung nach user_id ---
      {
        $group: {
          _id: "$user_id", // Gruppiert nach dem Feld user_id
          tests: { $push: "$$ROOT" }, // Schiebt das gesamte, bisherige Test-Dokument in ein Array
        },
      },
    ];

    const result = await instance.testDAO.aggregate(aggregateObj);
    return result;
  }

  /**
   * @method spec_getPerformance
   * @async
   * @param {string} userId - The ID of the user to retrieve performance data for.
   * @returns {Promise<Array<object>>} An array of performance statistics for the user's tests.
   */
  async spec_getPerformance(userId) {
    const instance = this;
    const aggregateObj = [
      { $match: { user_id: userId } },
      {
        $project: {
          date: "$_createdAt",
          testName: "$name",
          correct: 1,
          wrong: 1,
          totalQuestions: { $add: ["$correct", "$wrong"] },
          domains: 1, // <--- Nimmt das gesamte eingebettete 'domains'-Objekt mit
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
    return await instance.testDAO.aggregate(aggregateObj);
  }

  /*
  ==============================================
  🤖 AI TUTOR & PROCESSING
  ==============================================
  */

  /**
   * @method spec_explain
   * @async
   * @param {string} questionId - The ID of the question to explain.
   * @returns {Promise<string|null>} A Markdown-formatted explanation of the question and its answers, or null if an error occurs.
   */
  async spec_explain(questionId) {
    const instance = this; // Already defined
    try {
      let explanation = "";

      instance.logger.info(
        "Generating explanation for question: " + questionId,
      );

      instance.logger.debug(
        "Generating explanation for question: " + questionId,
      );

      const cacheRes = await instance.cacheDAO.findOne({ id: questionId });

      if (typeof cacheRes === "undefined" || cacheRes === null) {
        instance.logger.debug(
          "Cache miss for explanation. Requesting from AI...",
        );
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

        explanation = await instance.#explain(
          qstObj.question,
          answerArr,
          correctIdx,
        );

        const cacheObj = {
          id: questionId,
          text: explanation,
          init: () => {},
        };

        await instance.cacheDAO.create(cacheObj);
      } else {
        instance.logger.debug("Cache hit for explanation.");
        explanation = cacheRes.text;
      }

      return explanation;
    } catch (error) {
      console.log(error);
    }
  }

  /**
   * @method spec_getTotalQuestionCount
   * @async
   * @returns {Promise<number>} The total count of questions that have not yet been processed by the CISM AI.
   */
  async spec_getTotalQuestionCount() {
    const instance = this;
    // 1. Die Pipeline definieren // No 'this' to replace
    const pipeline = [
      {
        $lookup: {
          from: "cism_results",
          localField: "_id",
          foreignField: "_id",
          as: "already_processed",
        },
      },
      {
        $match: {
          "already_processed.0": { $exists: false },
        },
      },
      {
        $count: "totalUnprocessed",
      },
    ];

    // 2. Deine interne aggregate-Funktion aufrufen
    // Diese gibt bereits ein Array (docs) zurück!
    const results = await instance.questionDAO.aggregate(pipeline);

    // Debugging (optional)
    console.log("Result from internal aggregate:", results);

    // 3. Ergebnis extrahieren
    // Da deine aggregate-Funktion map() nutzt, sieht das Ergebnis so aus:
    // [{ id: "...", totalUnprocessed: 450 }] oder []
    if (results && results.length > 0) {
      return results[0].totalUnprocessed;
    }

    return 0;
  }

  /**
   * @method spec_getAllUsers
   * @async
   * @returns {Promise<Array<object>>} An array of all normalized user objects.
   */
  async spec_getAllUsers() {
    const instance = this;
    const users = await instance.userDAO.readAll();
    return users.map((u) => instance.normalizeUser(u));
  }

  /**
   * @method spec_deleteUser
   * @async
   * @param {string} userId - The ID of the user to delete.
   * @returns {Promise<object|null>} The normalized user object that was deleted, or null if not found.
   */
  async spec_deleteUser(userId) {
    const instance = this;
    instance.logger.debug("Deleting user: " + userId);
    const user = await instance.userDAO.delete(userId);
    instance.logger.info("User successfully deleted: " + userId);
    return instance.normalizeUser(user);
  }

  async spec_deleteTests(testIds) {
    const instance = this;

    try {
      // 1. Lösche die Tests
      const deleteTestPromises = testIds.map((testId) =>
        instance.testDAO.delete(testId),
      );
      await Promise.all(deleteTestPromises);

      // 2. Lösche die zugehörigen Test-Antworten
      const deleteAnswerPromises = testIds.map((testId) =>
        instance.testAnswersDAO.deleteMany({ test_id: testId }),
      );
      await Promise.all(deleteAnswerPromises);

      instance.logger.info(
        `Successfully deleted tests and their answers: ${testIds.join(", ")}`,
      );

      // ERFOLG zurückgeben
      return { success: true, message: "Tests erfolgreich gelöscht." };
    } catch (error) {
      instance.logger.error(`Failed to delete tests: ${error.message}`);

      // FEHLER zurückgeben, anstatt die App abstürzen zu lassen
      return { success: false, error: error.message };
    }
  }

  /**
   * @method spec_getQuestions
   * @async
   * @param {number} batchSize - The number of questions to retrieve in the batch.
   * @param {number} [offset=0] - The starting offset for pagination.
   * @returns {Promise<Array<object>>} An array of questions that have not yet been processed by the CISM AI, including their answers.
   */
  async spec_getQuestions(batchSize, offset = 0) {
    const instance = this;
    return await instance.questionDAO.aggregate([
      // 1. Einfacher Lookup (beide Seiten sind jetzt ObjectIDs)
      {
        $lookup: {
          from: "cism_results",
          localField: "_id",
          foreignField: "_id",
          as: "existing_result",
        },
      },

      // 2. Filter: Nur Dokumente behalten, die KEINEN Treffer in cism_result haben
      {
        $match: {
          "existing_result.0": { $exists: false },
        },
      },

      // 3. Sortierung (wichtig für konsistente Batches)
      { $sort: { _id: 1 } },

      // 4. Paginierung
      { $skip: offset },
      { $limit: batchSize },

      // 5. Verknüpfung mit der Answer-Collection
      // (Hier bleibt der String-Cast für 'question_id' nötig, falls diese dort als String liegt)
      {
        $lookup: {
          from: "answer",
          let: { qid: { $toString: "$_id" } },
          pipeline: [{ $match: { $expr: { $eq: ["$question_id", "$$qid"] } } }],
          as: "answers",
        },
      },

      // 6. Aufräumen
      { $project: { existing_result: 0 } },
    ]);
  }

  /**
   * @method spec_getDistinctDomainsAggregate
   * @async
   * @returns {Promise<Array<{_id: string}>>} Array von Objekten, z.B. [{_id: "IT"}, {_id: "Math"}]
   */
  async spec_getDistinctDomains() {
    const instance = this;

    const result = await instance.questionDAO.aggregate([
      {
        $group: {
          _id: "$domain", // Gruppiert nach der Domain, was Duplikate eliminiert
        },
      },
      {
        $sort: { _id: 1 }, // Optional: Sortiert die Domains alphabetisch
      },
    ]);

    // Sicherstellen, dass wir ein Array haben, und mappen
    return Array.isArray(result) ? result.map((item) => item._id) : [];
  }

  /**
   * @private
   * @method #explain
   * @async
   * @param {string} question - The question text.
   * @param {Array<string>} answers - An array of possible answers.
   * @param {number} correctIdx - The index of the correct answer in the `answers` array.
   * @returns {Promise<string>} A Markdown-formatted explanation generated by the Gemini AI.
   */
  async #explain(question, answers, correctIdx) {
    const instance = this; // Already defined

    try {
      const prompt = `
            You are a tutor. Please explain precise the following multiple choice question:
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

            Answer the question directly.

            Do NOT include:
            - introductions
            - meta commentary
            - phrases like "this is an excellent question"
            - any conversational filler

            Start immediately with structured Markdown content.

            Return ONLY valid Markdown.

            STRICT RULES:
            - Use ### for headings
            - Use * for bullet points
            - Use proper line breaks (\n)
            - Do NOT use numbers like "1." for headings
            - Do NOT use "." as bullet points
            - Do NOT include any introduction or explanation

            Start directly with the first heading.

            Example format:

            ### Title

            * Point 1
            * Point 2
            
            text that is **bold**

            text that is *italic*

            Be concise and factual.
        `;

      // ✅ Korrekter Aufruf für @google/generative-ai
      const result = await instance.genAIModel.generateContent(prompt);
      const response = await result.response;
      return response.text();
    } catch (error) {
      this.logger.error("Gemini API error: " + error.message);
      return "Entschuldigung, die Erklärung konnte nicht generiert werden.";
    }
  }

  /**
   * Verarbeitet einen Batch von CISM-Fragen über die KI und speichert Ergebnisse/Fehler.
   * @param {Array} normalizedQuestions - Die vorbereiteten Fragen
   * @returns {Promise<{success: Array, errors: Array}>}
  async spec_processCismBatchWithAI(normalizedQuestions) {
    const instance = this;
    const errorLog = [];
    const successResults = [];
    const timestamp = new Date();

    const prompt = `
    You are a CISM Exam Developer and Senior Cybersecurity Editor. 
    Your goal is to refine the following LIST of questions to meet Professional Exam Quality (ISACA standard).

    INPUT DATA (JSON Array):
    ${JSON.stringify(normalizedQuestions)}

    TASKS FOR EACH ITEM:
    1. EXAM QUALITY REVIEW: Ensure the "question_text" is concise, unambiguous, and uses professional CISM terminology (BEST, MOST, FIRST, GREATEST).
    2. DOMAIN ALIGNMENT: Assign the question to the most appropriate CISM Domain (Full Name).
    3. ADAPTATION LOGIC: Set "adapted" to true if you changed the wording for quality, clarity, or grammar.

    STRICT OUTPUT FORMAT:
    Return ONLY a valid JSON Array of objects. No markdown blocks, no intro, no meta-commentary.
    Maintain the EXACT original "_id" for each question.

    Expected Output Structure:
    [
      {
        "_id": "...",
        "domain": "Full Name of the CISM Domain",
        "question_text": "The refined, high-quality question text",
        "adapted": true/false
      }
    ]

    RULES:
    - Return the SAME number of objects as provided in the input.
    - Return ONLY the JSON Array.
    `;

    instance.logger.info("Starting Gemini Batch Processing with genAIModel...");

    try {
      const result = await this.genAIModel.generateContent(prompt);
      const response = await result.response;
      const responseText = response.text();

      let updatedQuestions;

      try {
        const cleanJson = responseText.replace(/```json|```/g, "").trim();
        updatedQuestions = JSON.parse(cleanJson);
      } catch (parseError) {
        instance.logger.error(
          "JSON Parse Error from Gemini:",
          parseError.message,
        );
        normalizedQuestions.forEach((q) => {
          errorLog.push({
            question_id: q._id,
            reason: "Invalid JSON response from API",
            _createdAt: timestamp,
          });
        });
      }

      if (updatedQuestions && Array.isArray(updatedQuestions)) {
        normalizedQuestions.forEach((original) => {
          const updated = updatedQuestions.find(
            (u) => u._id === original._id.toString(),
          );

          if (
            updated &&
            updated.domain &&
            updated.question_text !== undefined
          ) {
            // ✅ HIER ERFOLGT DIE KONVERTIERUNG ZUR OBJECT-ID
            successResults.push({
              ...updated,
              _id: new ObjectId(updated._id),
            });
          } else {
            errorLog.push({
              question_id: original._id,
              reason: updated
                ? "Missing fields in API response"
                : "Question missing in API response",
              _createdAt: timestamp,
            });
          }
        });
      }
    } catch (apiError) {
      instance.logger.error("Gemini API Error:", apiError.message);
      normalizedQuestions.forEach((q) => {
        errorLog.push({
          question_id: q._id,
          reason: `API Error: ${apiError.message}`,
          _createdAt: timestamp,
        });
      });
    }

    // --- FEHLER IN DIE DB SCHREIBEN ---
    if (errorLog.length > 0) {
      try {
        await this.GeminiErrorDAO.createMany(errorLog);
      } catch (dbError) {
        instance.logger.error(
          "Fehler beim Schreiben in GeminiError-Collection:",
          dbError,
        );
      }
    }

    // --- ERFOLGE IN DIE DB SCHREIBEN ---
    if (successResults.length > 0) {
      try {
        // Da die _id nun ein ObjectId ist, wird sie in MongoDB korrekt gespeichert
        await this.CISMResultsDAO.createMany(successResults);
        instance.logger.info(
          `${successResults.length} Fragen erfolgreich als ObjectId gespeichert.`,
        );
      } catch (dbError) {
        instance.logger.error(
          "Fehler beim Schreiben in CISMResults-Collection:",
          dbError,
        );
      }
    }

    return {
      success: successResults,
      errors: errorLog,
    };
  }
       */

  /**
   * @method spec_processCismAnswerBatchWithAI
   * @async
   * @description Processes CISM answers in batches using AI for spelling, grammar, and CISM terminology validation.
  
  async spec_processCismAnswerBatchWithAI() {
    const instance = this;
    const sourceColl = instance.DB.collection("answer");
    const targetColl = instance.DB.collection("validated_answers");

    const total = await sourceColl.countDocuments();
    const processedIds = await targetColl.distinct("original_id");
    const cursor = sourceColl.find({ _id: { $nin: processedIds } });

    console.log(
      `[CISM-LEVEL] Start validation. Remaining: ${total - processedIds.length}`,
    );

    let currentBatch = [];

    while (await cursor.hasNext()) {
      currentBatch.push(await cursor.next());

      if (
        currentBatch.length === 20 ||
        (!(await cursor.hasNext()) && currentBatch.length > 0)
      ) {
        const entriesForPrompt = currentBatch.map((d) => ({
          id: d._id.toString(),
          text: d.text,
        }));

        // Der oben definierte CISM-Prompt
        const prompt = `You are an expert ISACA CISM Exam Item Writer and English Proofreader.
Your task: Review 20 exam questions/answers for spelling, grammar, and CISM professional terminology.

STRICT CISM GUIDELINES:
1. LANGUAGE: Keep it strictly ENGLISH.
2. TERMINOLOGY: Ensure ISACA-standard terms are used (e.g., "Information Asset Owner" instead of "Data Owner" if appropriate, or "Risk Appetite" instead of "Risk Tolerance" if the context requires it).
3. QUALIFIERS: Do NOT change logic-defining words like "MOST", "FIRST", "PRIMARY", "BEST", or "GREATEST".
4. STYLE: Maintain a formal, neutral, and managerial tone. Avoid gender pronouns (use "the candidate", "the manager").
5. OUTPUT: 
   - If a text is already perfect in CISM quality, return "OK".
   - If corrections are needed, return ONLY the corrected version.
   - Return a valid JSON array of objects: [{"id": "...", "result": "..."}]

Input JSON: ${JSON.stringify(entriesForPrompt)}`;

        try {
          // Wir nutzen gemini-2.5-flash, das du bereits erfolgreich getestet hast
          const result = await instance.genAIModel.generateContent(prompt);
          let responseText = result.response.text().trim();

          // Extrahiere JSON aus möglichen Markdown-Blöcken
          const jsonMatch = responseText.match(/\[[\s\S]*\]/);
          if (!jsonMatch)
            throw new Error("Kein valides JSON im Response gefunden");

          const aiResults = JSON.parse(jsonMatch[0]);

          const operations = currentBatch.map((doc) => {
            const aiUpdate = aiResults.find((r) => r.id === doc._id.toString());
            const correctedText =
              aiUpdate && aiUpdate.result !== "OK" ? aiUpdate.result : doc.text;

            return {
              question: doc.question,
              answer: doc.answer,
              text: correctedText,
              question_id: doc.question_id,
              original_id: doc._id,
              validated_at: new Date(),
              was_corrected: aiUpdate && aiUpdate.result !== "OK",
              quality_level: "CISM-Certified-Style",
            };
          });

          await targetColl.insertMany(operations);
          console.log(
            `Batch verarbeitet: +${currentBatch.length} (Gesamt: ${processedIds.length + currentBatch.length}/${total})`,
          );

          currentBatch = [];
          // Kurze Pause gegen Rate-Limits
          await new Promise((resolve) => setTimeout(resolve, 800));
        } catch (error) {
          console.error("Batch-Fehler:", error.message);
          // Bei Fehler im 20er-Block: Wir leeren den Batch, damit das Skript nicht hängen bleibt
          currentBatch = [];
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      }
    }
  }

   */
  /**
   * AnythingLLM-Version
   * @param {*} question
   * @param {*} answers
   * @param {*} correctIdx
   * @returns
   */
  /**
   * @private
   * @method #_explain
   * @async
   * @param {string} question - The question text.
   * @param {Array<string>} answers - An array of possible answers.
   * @param {number} correctIdx - The index of the correct answer in the `answers` array.
   * @returns {Promise<string>} An explanation generated by an external LLM (AnythingLLM).
   */
  async #_explain(question, answers, correctIdx) {
    const instance = this;
    try {
      const prompt = ` // No 'this' to replace
      You are a tutor. Please explain precise the following multiple choice question:
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

      Answer the question directly.

      Do NOT include:
      - introductions
      - meta commentary
      - phrases like "this is an excellent question"
      - any conversational filler

      Start immediately with structured Markdown content.

      Return ONLY valid Markdown.

      STRICT RULES:
      - Use ### for headings
      - Use * for bullet points
      - Use proper line breaks (\\n)
      - Do NOT use numbers like "1." for headings
      - Do NOT use "." as bullet points
      - Do NOT include any introduction or explanation

      Start directly with the first heading.

      Example format:

      ### Title

      * Point 1
      * Point 2

      text that is **bold**

      text that is *italic*

      Be concise and factual.
      `;

      const response = await fetch(
        "http://localhost:3001/api/v1/workspace/YOUR_WORKSPACE/chat",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer YOUR_API_KEY`,
          },
          body: JSON.stringify({
            message: prompt,
            mode: "chat",
          }),
        },
      );

      const data = await response.json();

      return data.textResponse || "Keine Antwort erhalten.";
    } catch (error) {
      console.error("AnythingLLM API error:", error.message);
      return "Entschuldigung, die Erklärung konnte nicht generiert werden.";
    }
  }
}

export default new MongoDatabase();
