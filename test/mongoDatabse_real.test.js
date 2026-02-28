import { DB_STRING, DB_TEST_NAME } from  "/config.js";
import LogManager from "/lib/logging/LogManager.js";
import MongoCollectionReadOnly from  "/lib/database/dao/MongoCollectionReadOnly.js";
import MongoCollectionReadWrite from  "/lib/database/dao/MongoCollectionReadWrite.js";
import MongoDatabase from  "/lib/database/MongoDatabase.js";
import TestInfo from  "/lib/database/model/TestInfo.js";
import TestAnswer from  "/lib/database/model/TestAnswer.js";
import { MongoClient, ObjectId } from  "mongodb";
import { faker } from  "@faker-js/faker";

describe("MongoDatabase_real", () => {
  let client;
  let database;
  let questionCol;
  let answerCol;
  let testInfoCol;
  let testAnswerCol;

  let question;
  let answer;
  let qst;
  let tst;
  let tstInfo;
  let tstanswers;
  let tstAnswersObj;

  /**
   * beforeAll
   *
   * Will be executed before all tests
   */
  beforeAll(async () => {
    client = new MongoClient(DB_STRING);
    await client.connect();

    database = client.db(DB_TEST_NAME);

    await MongoDatabase.init(DB_STRING, DB_TEST_NAME, LogManager);
    //await MongoDatabase.connect();

    questionCol = database.collection("question");
    question = new MongoCollectionReadOnly(questionCol);
    await question.init(LogManager);

    answerCol = database.collection("answer");

    answer = new MongoCollectionReadOnly(answerCol);
    await answer.init(LogManager);

    tst = database.collection("test");

    const testMetaValidator = (info) => {
      if (info == null) {
        throw new Error("testInfoCol not defined!");
      }

      if (typeof info !== "object" && !(info instanceof TestInfo)) {
        throw new Error("Invalid data type given");
      }

      if (typeof info.name !== "string") {
        throw new Error("Invalid name: expected string");
      }

      if (typeof info.user !== "string") {
        throw new Error("Invalid user: expected string");
      }

      if (typeof info.createdAT !== "object" || info.createdAT === null) {
        throw new Error("Invalid createdAT: expected Date object");
      }

      if (typeof info.correct !== "number") {
        throw new Error("Invalid correct: expected number");
      }

      if (typeof info.wrong !== "number") {
        throw new Error("Invalid wrong: expected number");
      }

      return true; // optional, aber sauber
    };

    testInfoCol = new MongoCollectionReadWrite(tst, testMetaValidator);
    await testInfoCol.init(LogManager);

    tstanswers = database.collection("test_answers");
    const testAnswerColValidator = (testAnswer) => {
      if (testAnswer == null) {
        throw new Error("testAnswerCol not defined!");
      }

      if (
        typeof testAnswer !== "object" &&
        !(testAnswer instanceof TestAnswer)
      ) {
        throw new Error("Invalid data type given");
      }
      if (
        typeof testAnswer.test_id !== "object" ||
        testAnswer.test_id === null
      ) {
        throw new Error("Invalid test_id: expected ObjectId");
      }
      if (
        typeof testAnswer.question_id !== "object" ||
        testAnswer.question_id === null
      ) {
        throw new Error("Invalid question_id: expected ObjectId");
      }
      if (
        typeof testAnswer.answer_id !== "object" ||
        testAnswer.answer_id === null
      ) {
        throw new Error("Invalid answer_id: expected ObjectId");
      }
      if (typeof testAnswer.correct !== "boolean") {
        throw new Error("Invalid correct: expected boolean");
      }
    }

      testAnswerCol = new MongoCollectionReadWrite(
        tstanswers,
        testMetaValidator,
      );

      await testAnswerCol.init(LogManager);

      return true; // optional
    });

  /**
   * Will be executed after all tests are finished
   */
  afterAll(async () => {
    await MongoDatabase.close();

    await client.close();
  });

  /**
   * Create a full question object in collection "question" and collection "answer"
   */
  const createFullQuestion = async () => {
    qstObject = {
      _id: new ObjectId(),
      ID: 1,
      question: faker.lorem.word(255),
      correct: faker.lorem.word(1),
    };

    result = await questionCol.insertOne(qstObject);

    // console.log(result);

    const getAnswer = () => {
      return {
        _id: new ObjectId(),
        question: qstObject.ID,
        answer: faker.lorem.word(1),
        text: faker.lorem.word(50),
        question_id: qstObject._id.toString(),
      };
    };

    const answrs = new Array();
    answrs.push(getAnswer());
    answrs.push(getAnswer());
    answrs.push(getAnswer());
    answrs.push(getAnswer());

    result = await answerCol.insertMany(answrs);

    return qstObject;
  };

  /**
   * Deletes the full question object form "question" and "answer"
   */
  const cleanFullQuestion = async () => {
    result = await questionCol.deleteOne({
      _id: qstObject._id,
    });

    // console.log(result);

    result = await answerCol.deleteMany({
      question_id: qstObject._id.toString(),
    });

    // console.log(result);

    return result;
  };

  const createTestInfo = async () => {
    tstInfo = {
      _id: new ObjectId(),
      createdAT: new Date(),
      name: faker.lorem.word(20),
      wrong: 0,
      user: "0000-0000-0000-0000",
    };

    await tst.insertOne(tstInfo);

    return tstInfo;
  };

  const createTstAnswers = async (testInfoId) => {
    const createAnswer = (res) => {
      res = res != null ? true : false;

      const fakeQuestionId = new ObjectId();
      const fakeAnswerId = new ObjectId();

      return {
        _id: new ObjectId(),
        test_id: testInfoId.toString(),
        question_id: fakeQuestionId.toString(),
        answer_id: fakeAnswerId.toString(),
        correct: res,
        createdAT: new Date(),
      };
    };

    tstAnswersObj = new Array();
    tstAnswersObj.push(createAnswer());
    tstAnswersObj.push(createAnswer());
    tstAnswersObj.push(createAnswer());
    tstAnswersObj.push(createAnswer(true));
    tstAnswersObj.push(createAnswer(true));
    tstAnswersObj.push(createAnswer(true));

    result = await tstanswers.insertMany(tstAnswersObj);

    return tstAnswersObj;
  };

  const cleanTestInfo = async (idObject) => {
    let id;

    if (idObject == null) {
      id = tstInfo._id;
    } else {
      id = idObject;
    }

    await tst.deleteOne({
      _id: id,
    });

    const search = {
      test_id: id.toString(),
    };

    return await tstanswers.deleteMany(search);
  };

  describe("Question_read", () => {
    test("Simply reads a question form live db", async () => {
      await createFullQuestion();

      try {
        // Frage
        const id = qstObject._id.toString();
        const result = await question.getById(id);

        expect(result).not.toBeNull();
        expect(result).toHaveProperty("_id", "ID", "question", "correct");

        //Antworten

        const search = {
          question_id: id,
        };
        const answers = await answer.find(search);

        expect(answers).not.toBeNull();
        expect(answers).toBeInstanceOf(Array);
        expect(answers.length).toBe(4);
      } finally {
        await cleanFullQuestion();
      }
    });
  });

  describe("Question_full", () => {
    test("Reads a full question object from database via MongoDatabase", async () => {
      await createFullQuestion();

      try {
        const qstId = qstObject._id.toString();

        const result = await MongoDatabase.spec_getQuestionFull(qstId);

        expect(result).not.toBeNull();
        expect(result).toHaveProperty(
          "_id",
          "ID",
          "question",
          "correct",
          "answers",
        );
        expect(result._id).toBeInstanceOf(Object);
        expect(result.answers.length).toBe(4);
      } finally {
        await cleanFullQuestion();
      }
    });
  });
  describe("Test_full", () => {
    test("Calculates a given test object and get it full from database", async () => {
      const testInfo = await createTestInfo();
      await createTstAnswers(testInfo._id);

      // Calculate test info results
      try {
        const result = await MongoDatabase.spec_calculateTestResult(
          tstInfo._id.toString(),
        );

        expect(result).not.toBeNull();
        expect(result).toHaveProperty(
          "_id",
          "name",
          "wrong",
          "correct",
          "user",
        );
        expect(result.correct).toBe(3);
        expect(result.wrong).toBe(3);
        //console.log(result);
      } finally {
        await cleanTestInfo(testInfo._id);
      }
    });
  });

  describe("testInfoCol_create", () => {
    test("Gets tests by a given date period", async () => {
      let tests = new Array();
      let i = 5;

      for (idx = 0; idx < i; idx++) {
        let tstInfo = await createTestInfo();
        await createTstAnswers(tstInfo._id);
        tests.push(tstInfo._id);
      }

      try {
        const start = new Date();
        start.setHours(0, 0, 0, 0);

        const end = new Date();
        end.setHours(23, 59, 59, 999);

        const result = await MongoDatabase.spec_getTestResult(start, end);

        expect(result).not.toBeNull();
        expect(result).toBeInstanceOf(Array);
        expect(result.length).toBe(5);
      } finally {
        for (idx = 0; idx < tests.length; idx++) {
          await cleanTestInfo(tests[idx]);
        }
      }
    });
  });

  describe("testAnswerCol_write", () => {
    test("Gets a random question from the database", async () => {

    jest.setTimeout(30000)

      let qstns = new Array();
      let i = 10;

      for (idx = 0; idx < i; idx++) {
        const qst = await createFullQuestion();
        qstns.push(qst._id);
      }

      try {
        const result = await MongoDatabase.getQuestion();
        expect(result).not.toBeNull();
        expect(result).toHaveProperty(
          "_id",
          "ID",
          "question",
          "correct",
          "answers",
        );
        expect(result._id).toBeInstanceOf(Object);
        expect(result.answers.length).toBe(4);
      } finally {
        await questionCol.deleteMany({ _id: { $in: qstns } });
        await answerCol.deleteMany({
          question_id: { $in: qstns.map((id) => id.toString()) },
        });
      }
    });
  });
});
