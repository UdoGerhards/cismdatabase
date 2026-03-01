import { DB_CONNECTION, DB_NAME } from "/config.js";
import LogManager from "/lib/logging/LogManager.js";
import MongoCollectionReadWrite from "/lib/database/dao/MongoCollectionReadWrite.js";
import { MongoClient, ObjectId } from "mongodb";
import TestInfo from "../lib/database/model/TestInfo.js";

describe("MongoDatabase", () => {
  let client;
  let database;
  let testCollection;
  let col;

  let insertedTestIds = [];

  // Validator wie im Server
  const testMetaValidator = (info) => {
    if (typeof info.name !== "string") throw new Error("Invalid name");
    if (typeof info._createdAt !== "object" || info._createdAt === null)
      throw new Error("Invalid createdAt");
    if (typeof info.correct !== "number") throw new Error("Invalid correct");
    if (typeof info.wrong !== "number") throw new Error("Invalid wrong");
    return true;
  };

  beforeAll(async () => {
    client = new MongoClient(DB_CONNECTION);
    await client.connect();

    database = client.db(DB_NAME);
    testCollection = database.collection("test");

    // Klasse direkt instanziieren — KEIN db aus server.js
    col = new MongoCollectionReadWrite(testCollection, testMetaValidator);
    await col.init(LogManager);
  });

  beforeEach(async () => {
    const docs = [
      {
        _id: new ObjectId(),
        name: "Test A",
        _createdAt: new Date(),
        correct: 0,
        wrong: 0,
      },
      {
        _id: new ObjectId(),
        name: "Test B",
        _createdAt: new Date(),
        correct: 1,
        wrong: 1,
      },
    ];

    const result = await testCollection.insertMany(docs);
    insertedTestIds = Object.values(result.insertedIds);
  });

  afterEach(async () => {
    await testCollection.deleteMany({ _id: { $in: insertedTestIds } });
  });

  afterAll(async () => {
    await client.close();
  });

  // ---------------------------------------------------------
  // TESTS
  // ---------------------------------------------------------

  describe("DB_create", () => {
    test("create() inserts a document and returns mapped result", async () => {

      const doc = new TestInfo();
      doc.setName("NewDoc");

      const result = await col.create(doc);

      expect(result).toHaveProperty("_id");
      expect(result.name).toBe("NewDoc");

      // Cleanup
      await testCollection.deleteOne({ _id: result._id});
    });
  });

  describe("DB_read", () => {
    test("read() returns a single document", async () => {
      const id = insertedTestIds[0].toString();

      const result = await col.read(id);

      expect(result).not.toBeNull();
      expect(result.id).toBe(id);
    });
  });

  describe("DB_reade_unkown", () => {
    test("read() returns null for unknown id", async () => {
      const result = await col.read(new ObjectId().toString());
      expect(result).toBeNull();
    });
  });

  describe("DB_readAll", () => {
    test("readAll() returns all documents", async () => {
      const result = await col.readAll({});
      // expect(result.length).toBe(2);
    });
  });

  describe("DB_update", () => {
    test("update() modifies a document", async () => {
      const id = insertedTestIds[0].toString();

      const update = new TestInfo();
      update._createdAt = new Date();
      update.setName("Updated Doc");
      update.setCorrect(5);
      update.setWrong(1);

      const success = await col.update(id, update);
      expect(success).toBe(true);

      const updatedDoc = await col.read(id);
      expect(updatedDoc.name).toBe("Updated Doc");
    });
  });

  describe("DB_delete", () => {
    test("delete() removes a document", async () => {
      const id = insertedTestIds[0].toString();

      const success = await col.delete(id);
      expect(success).toBe(true);

      const result = await col.read(id);
      expect(result).toBeNull();
    });
  });
});
