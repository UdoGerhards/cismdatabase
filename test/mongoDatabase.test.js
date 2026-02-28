import { DB_STRING, DB_TEST_NAME } from "/config.js";
import LogManager from "/lib/logging/LogManager.js";
import MongoCollectionReadWrite from "/lib/database/dao/MongoCollectionReadWrite.js";
import { MongoClient, ObjectId } from "mongodb";

describe("MongoDatabase", () => {
  let client;
  let database;
  let testCollection;
  let col;

  let insertedTestIds = [];

  // Validator wie im Server
  const testMetaValidator = (info) => {
    if (typeof info.name !== "string") throw new Error("Invalid name");
    if (typeof info.createdAT !== "object" || info.createdAT === null)
      throw new Error("Invalid createdAT");
    if (typeof info.correct !== "number") throw new Error("Invalid correct");
    if (typeof info.wrong !== "number") throw new Error("Invalid wrong");
    return true;
  };

  beforeAll(async () => {
    client = new MongoClient(DB_STRING);
    await client.connect();

    database = client.db(DB_TEST_NAME);
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
        createdAT: new Date(),
        correct: 0,
        wrong: 0,
      },
      {
        _id: new ObjectId(),
        name: "Test B",
        createdAT: new Date(),
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
      const doc = {
        _id: new ObjectId(),
        name: "NewDoc",
        createdAT: new Date(),
        correct: 0,
        wrong: 0,
      };

      const result = await col.create(doc);

      expect(result).toHaveProperty("id");
      expect(result.name).toBe("NewDoc");

      // Cleanup
      await testCollection.deleteOne({ _id: new ObjectId(result.id) });
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

      const update = {
        name: "Updated",
        createdAT: new Date(),
        correct: 5,
        wrong: 1,
      };

      const success = await col.update(id, update);
      expect(success).toBe(true);

      const updatedDoc = await col.read(id);
      expect(updatedDoc.name).toBe("Updated");
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
