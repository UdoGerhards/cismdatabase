process.env.JWT_SECRET = "testsecret";

import { DB_CONNECTION, DB_NAME } from "../config.js";
import Server from "../lib/server/routes.js";
import { MongoClient, ObjectId } from "mongodb";
import { faker } from "@faker-js/faker";

jest.setTimeout(10000); // 10 Sekunden

describe("Servertest - testing http requests to the server", () => {
  let server;
  const PORT = 3000;

  let client;
  let database;
  let question;
  let answer;
  let qst;
  let tst;
  let tstInfo;
  let tstanswers;
  let tstAnswersObj;

  beforeAll(async () => {
    // Mongo direct

    client = new MongoClient(DB_CONNECTION);
    await client.connect();

    database = client.db(DB_NAME);
    questionCol = database.collection("question");
    answerCol = database.collection("answer");
    tst = database.collection("test");
    tstanswers = database.collection("test_answers");

    // Server
    server = new Server(DB_NAME, DB_CONNECTION);
    await server.init();
    server.listen(PORT);
  });

  afterAll(async () => {
    await server.close();
    await client.close();
  });

  /**
   * Create a full question in test database
   */
  const createFullQuestion = async () => {
    let qstObject = {
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

  const createTestInfoObject = () => {
    return {
      _id: new ObjectId(),
      _createdAt: new Date(),
      name: faker.lorem.word(20),
      wrong: 0,
      user: "0000-0000-0000-0000",
    };
  };

  /**
   * Creates a test object in test database
   */
  const createTestInfo = async () => {
    tstInfo = createTestInfoObject();
    await tst.insertOne(tstInfo);

    return tstInfo;
  };

  /**
   * Creates the given answers to a given test
   */

  const createTstAnswerOject = (tstId, res) => {
    res = res != null ? true : false;

    const fakeQuestionId = new ObjectId();
    const fakeAnswerId = new ObjectId();

    return {
      _id: new ObjectId(),
      test_id: tstId.toString(),
      question_id: fakeQuestionId.toString(),
      answer_id: fakeAnswerId.toString(),
      correct: res,
      _createdAt: new Date(),
    };
  };

  const createTstAnswers = async (testInfoId) => {
    tstAnswersObj = new Array();
    tstAnswersObj.push(createTstAnswerOject(testInfoId.toString()));
    tstAnswersObj.push(createTstAnswerOject(testInfoId.toString()));
    tstAnswersObj.push(createTstAnswerOject(testInfoId.toString()));
    tstAnswersObj.push(createTstAnswerOject(testInfoId.toString(), true));
    tstAnswersObj.push(createTstAnswerOject(testInfoId.toString(), true));
    tstAnswersObj.push(createTstAnswerOject(testInfoId.toString(), true));

    result = await tstanswers.insertMany(tstAnswersObj);

    return tstAnswersObj;
  };

  /**
   * Clean up: Deletes a full test object from the database
   */
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

  /**
   * Clean up: Deletes the full question object form "question" and "answer"
   */
  const cleanFullQuestion = async (id) => {
    result = await questionCol.deleteOne({
      _id: id,
    });

    // console.log(result);

    result = await answerCol.deleteMany({
      question_id: id.toString(),
    });

    // console.log(result);

    return result;
  };

  describe("Getting a new question object from server ", () => {
    test("POST /api/question", async () => {
      let questionObjects = Array();

      try {
        for (idx = 0; idx < 10; idx++) {
          let questionObject = await createFullQuestion();
          questionObjects.push(questionObject._id);
        }

        const res = await fetch(`http://127.0.0.1:${PORT}/api/question`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });

        expect(res.status).toBe(200);

        const data = await res.json();

        expect(data).not.toBeNull();
        expect(data._id).toBeDefined();
        expect(typeof data._id).toBe("string");

        expect(data.question).toBeDefined();
        expect(typeof data.question).toBe("string");

        expect(data.answers).toBeDefined();
        expect(typeof data.answers).toBe("object");
        expect(data.answers.length).toBe(4);

        expect(data.correct).toBeDefined();
        expect(typeof data.correct).toBe("string");
      } finally {
        for (const id of questionObjects) {
          await cleanFullQuestion(id);
        }
      }
    });
  });

  describe("Getting a full test with answers from the database", () => {
    test("POST /api/get/test/for/period", async () => {
      // Preparation
      let testObjects = Array();

      try {
        for (idx = 0; idx < 10; idx++) {
          let testObject = await createTestInfo();
          testObjects.push(testObject._id);

          await createTstAnswers(testObject._id);
        }

        const start_date = new Date();
        start_date.setHours(0, 0, 0, 0);

        const end_date = new Date();
        end_date.setHours(23, 59, 59, 999);

        const res = await fetch(
          `http://127.0.0.1:${PORT}/api/get/test/for/period`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              start_date: start_date,
              end_date: end_date,
            }),
          },
        );

        expect(res.status).toBe(200);

        const data = await res.json();

        expect(data).toBeDefined();
        expect(Array.isArray(data)).toBe(true);
        expect(data.length).toBe(10);
      } finally {
        // Clean up
        for (const id of testObjects) {
          await cleanTestInfo(id);
        }
      }
    });
  });

  describe("POST /api/test - Create a test", () => {
    test("Creating a test info object in database", async () => {
      let res = await fetch(`http://127.0.0.1:${PORT}/api/test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Udo.Gerhards@gerhards.eu",
        }),
      });

      expect(res.status).toBe(200);

      const data = await res.json();

      expect(data).toBeDefined();
      expect(typeof data).toBe("object");
      expect(data).toHaveProperty("_id", "name", "correct", "wrong", "user");

      await cleanTestInfo(new ObjectId(data._id));
    });
  });

  describe("POST /api/test/answer- Save an answer to a test", () => {
    test("Creating a test info object in database", async () => {
      let data;

      try {
        let res = await fetch(`http://127.0.0.1:${PORT}/api/test`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Udo.Gerhards@gerhards.eu",
          }),
        });

        expect(res.status).toBe(200);

        data = await res.json();

        expect(data).toBeDefined();
        expect(typeof data).toBe("object");
        expect(data).toHaveProperty("_id", "name", "correct", "wrong", "user");

        let answer = createTstAnswerOject(data._id.toString());

        res = await fetch(`http:127.0.0.1:${PORT}/api/test/answer`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            testId: answer.test_id,
            answerId: answer.answer_id,
            questionId: answer.question_id,
            correct: true,
          }),
        });

        expect(res.status).toBe(200);
      } finally {
        await cleanTestInfo(new ObjectId(data._id));
      }
    });
  });

  describe("POST /api/test/results -  Calculates a test result and return it to the caller", () => {
    test("Creating a test info object in database", async () => {
      let test = null;
      try {
        test = await createTestInfo();
        await createTstAnswers(test._id);

        let res = await fetch(`http://127.0.0.1:${PORT}/api/test/result`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: test._id,
          }),
        });

        expect(res.status).toBe(200);

        const data = await res.json();

        expect(data).toBeDefined();
        expect(typeof data).toBe("object");
        expect(data).toHaveProperty("_id", "name", "correct", "wrong", "user");
      } finally {
        await cleanTestInfo(test._id);
      }
    });
  });
});
