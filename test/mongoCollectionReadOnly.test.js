import { DB_CONNECTION } from "/config.js";
import LogManager from "/lib/logging/LogManager.js";
import MongoCollectionReadOnly from "/lib/database/dao/MongoCollectionReadOnly.js";
import { MongoClient, ObjectId } from "mongodb";

describe("MongoCollectionReadOnly", () => {
  let client;
  let db;
  let questionCollection;
  let col; // Instanz deiner Klasse

  beforeAll(async () => {
    client = new MongoClient(DB_CONNECTION);
    await client.connect();

    db = client.db("cism"); // oder dein DB-Name
    questionCollection = db.collection("question");

    col = new MongoCollectionReadOnly(questionCollection);
    await col.init(LogManager);
  });

  afterAll(async () => {
    await client.close();
  });

  describe("Find", () => {
    test("find() returns mapped documents", async () => {
      const search = {
        ID: 35,
      };

      const result = await col.find(search);

      expect(result.length).toBe(1);
      expect(result[0]).toHaveProperty("correct");
      expect(result[0]).toHaveProperty("question");
    });
  });

  describe("read", () => {
    test("read() returns a single document", async () => {
      const id = "697b5eef178c1da0410e7a26";

      const result = await col.read(id);

      expect(result).not.toBeNull();
      expect(result.id).toBe(id);
    });
  });

  describe("read", () => {
    test("read() returns null for unknown id", async () => {
      const result = await col.read(new ObjectId().toString());
      expect(result).toBeNull();
    });
  });

  describe("readAll", () => {
    test("readAll() returns all documents", async () => {
      const result = await col.readAll({});
      expect(result.length).toBe(1016);
    });
  });

  describe("readNumber", () => {
    test("readNumber() returns sample documents with lookup", async () => {
      const result = await col.readNumber(2);

      expect(result.length).toBe(2);
      expect(result[0]).toHaveProperty("answers"); // wegen $lookup
    });
  });
});
