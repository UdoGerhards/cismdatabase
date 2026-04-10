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
import crypto from "crypto";

import "dotenv/config";

class MongoDatabase extends Base {
  constructor() {
    super();

    this.questionDAO = null;
    this.answerDAO = null;
    this.testDAO = null;
    this.testAnswersDAO = null;
    this.userDAO = null;
    this.cacheDAO = null;
    this.GeminiErrorDAO = null;
    this.CISMResultsDAO = null;

    this.genAI = null;
    this.genAIModel = null;
    this.DB = null;
  }

  async init(logManager) {
    super.init(logManager);

    this.dbConnectionString = DB_CONNECTION;
    this.dbName = DB_NAME;

    this.genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    this.genAIModel = this.genAI.getGenerativeModel({
      model: "gemini-2.5-flash",
      //model: "gemini-1.5-flash-latest",
    });

    if (this.client) return;

    this.client = new MongoClient(this.dbConnectionString);
    await this.client.connect();
    this.DB = this.client.db(this.dbName);

    // ======================
    // DAOs
    // ======================

    class QuestionDAO extends MongoCollectionReadOnly {}
    this.questionDAO = new QuestionDAO(this.DB.collection("question"));
    this.questionDAO.init(logManager);

    class AnswerDAO extends MongoCollectionReadOnly {}
    this.answerDAO = new AnswerDAO(this.DB.collection("answer"));
    this.answerDAO.init(logManager);

    class TestDAO extends MongoCollectionReadWrite {}
    this.testDAO = new TestDAO(this.DB.collection("test"), (info) => {
      if (typeof info.name !== "string") throw new Error("Invalid name");
      if (typeof info.user_id !== "string") throw new Error("Invalid user");
      return true;
    });
    this.testDAO.init(logManager);

    class TestAnswersDAO extends MongoCollectionReadWrite {}
    this.testAnswersDAO = new TestAnswersDAO(
      this.DB.collection("test_answers"),
      () => true,
    );

    this.testAnswersDAO.init(logManager);

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
    this.userDAO = new UserDAO(this.DB.collection("user"), userValidator);
    this.userDAO.init(logManager);

    class CacheDAO extends MongoCollectionReadWrite {}
    this.cacheDAO = new CacheDAO(this.DB.collection("cache"), () => true);
    this.cacheDAO.init(logManager);

    class GeminiErrorDAO extends MongoCollectionReadWrite {}
    this.GeminiErrorDAO = new GeminiErrorDAO(
      this.DB.collection("gemini_errors"),
    );
    this.GeminiErrorDAO.init(logManager);

    class CISMResultsDAO extends MongoCollectionReadWrite {}
    this.CISMResultsDAO = new CISMResultsDAO(
      this.DB.collection("cism_results"),
    );
    this.CISMResultsDAO.init(logManager);
  }

  async close() {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  /*
  ==============================================
  🔥 USER HELPERS
  ==============================================
  */

  normalizeUser(user) {
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

  async getUser(email) {
    if (!email) return null;
    const user = await this.userDAO.findOne({ email: email.trim() });
    return this.normalizeUser(user);
  }

  async getUserById(id) {
    if (!id) return null;
    const user = await this.userDAO.findOne({ _id: new ObjectId(id) });
    return this.normalizeUser(user);
  }

  async changePassword(userId, newPassword) {
    const user = await this.getUserById(userId);
    if (!user) throw new Error("USER_NOT_FOUND");

    if (!validatePassword(newPassword, PASSWORD_RULES)) {
      throw new Error("PASSWORD_WEAK");
    }

    const isSame = await bcrypt.compare(newPassword, user.passwordHash);
    if (isSame) throw new Error("PASSWORD_SAME");

    const passwordHash = await bcrypt.hash(newPassword, 12);

    return await this.updateUser(userId, {
      passwordHash,
      mustChangePassword: false,
    });
  }

  async createUser({ email, firstname, lastname }) {
    const normalizedEmail = email.trim();

    const existingUser = await this.userDAO.findOne({
      email: normalizedEmail,
    });

    const rawPassword = crypto.randomBytes(8).toString("base64");
    const cleanPassword = rawPassword.replace(/[+/=]/g, "A");

    const passwordHash = await bcrypt.hash(cleanPassword, 12);

    const updateData = {
      passwordHash,
      mustChangePassword: true,
      twoFactor: {
        enabled: false,
        secret: null,
        tempSecret: null,
        loginAttempts: 0,
        lockUntil: null,
      },
    };

    if (existingUser) {
      await this.updateUser(existingUser._id, updateData);
      return {
        userId: existingUser._id,
        initialPassword: cleanPassword,
        updated: true,
      };
    }

    const user = {
      email: normalizedEmail,
      firstname,
      lastname,
      ...updateData,
      createdAt: new Date(),
      init() {},
    };

    const createdUser = await this.userDAO.create(user);

    return {
      userId: createdUser?._id,
      initialPassword: cleanPassword,
      created: true,
    };
  }

  async updateUser(id, updateObject) {
    return await this.userDAO.update(id, updateObject);
  }

  /*
  ==============================================
  BUSINESS LOGIC (UNVERÄNDERT)
  ==============================================
  */

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

  async spec_getAllTestsFull(userId = null) {
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
          as: "fullAnswers", // Name geändert, um Konflikt mit dem bestehenden 'answers' Feld zu vermeiden
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
      // Optional: Entferne das temporäre Hilfsfeld wieder
      { $project: { fullAnswers: 0 } },
    ];

    const result = await this.testDAO.aggregate(aggregateObj);
    return result; // Gibt ein Array aller (gefilterten) Test-Objekte zurück
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
    try {
      let explanation = "";

      const cacheRes = await instance.cacheDAO.findOne({ id: questionId });

      if (typeof cacheRes === "undefined" || cacheRes === null) {
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
        explanation = cacheRes.text;
      }

      return explanation;
    } catch (error) {
      console.log(error);
    }
  }

  async spec_getTotalQuestionCount() {
    // 1. Die Pipeline definieren
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
    const results = await this.questionDAO.aggregate(pipeline);

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

  async spec_getAllUsers() {
    const users = await this.userDAO.readAll();
    return users.map((u) => this.normalizeUser(u));
  }

  async spec_deleteUser(userId) {
    const user = await this.userDAO.delete(userId);
    return this.normalizeUser(user);
  }

  async spec_getQuestions(batchSize, offset = 0) {
    return await this.questionDAO.aggregate([
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

  async #explain(question, answers, correctIdx) {
    const instance = this;

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
      const result = await this.genAIModel.generateContent(prompt);
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

  async spec_processCismAnswerBatchWithAI() {
    const sourceColl = this.DB.collection("answer");
    const targetColl = this.DB.collection("validated_answers");

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
          const result = await this.genAIModel.generateContent(prompt);
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
  /**
   * AnythingLLM-Version
   * @param {*} question
   * @param {*} answers
   * @param {*} correctIdx
   * @returns
   */
  async #_explain(question, answers, correctIdx) {
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

  /**
   * Löscht mehrere Tests und alle damit verknüpften Antworten.
   * @param {Array<string>} testIds - Ein Array von Test-IDs (_id als String)
   */
  async spec_deleteTests(testIds) {
    if (!testIds || !Array.isArray(testIds) || testIds.length === 0) {
      return { deletedTests: 0, deletedAnswers: 0 };
    }

    // 1. Umwandlung der String-IDs in ObjectIDs für die Test-Kollektion
    const objectIds = testIds.map((id) => new ObjectId(id));

    try {
      // 2. Lösche alle verknüpften Antworten in 'test_answers'
      // Hier nutzen wir direkt die Strings, da test_id in deiner DB laut Aggregation ein String ist
      const answerResult = await this.testAnswersDAO.deleteMany({
        test_id: { $in: testIds },
      });

      // 3. Lösche die Test-Dokumente selbst
      const testResult = await this.testDAO.deleteMany({
        _id: { $in: objectIds },
      });

      return {
        success: true,
        deletedTests: testResult.deletedCount,
        deletedAnswers: answerResult.deletedCount,
      };
    } catch (err) {
      console.error("Error in spec_deleteTests:", err);
      throw err;
    }
  }
}

export default new MongoDatabase();
