import { DB_CONNECTION, DB_NAME } from "/config.js";
import LogManager from "/lib/logging/LogManager.js";
import MongoCollectionReadWrite from "/lib/database/dao/MongoCollectionReadWrite.js";
import { MongoClient, ObjectId } from "mongodb";
import TestInfo from "../lib/database/model/TestInfo.js";

describe("MongoCollectionReadWrite", () => {
  let client;
  let db;
  let testCollection;
  let col;
  let insertedIds = [];

  const validator = (doc) => {
    if (typeof doc.name !== "string") {
      throw new Error("Invalid name");
    }
    if (typeof doc._createdAt !== "object" || doc._createdAt === null) {
      console.log(doc);
      console.log(typeof doc._createdAt);
      console.log(doc._createdAt);

      throw new Error("Invalid createdAt");
    }
    return true;
  };

  beforeAll(async () => {
    client = new MongoClient(DB_CONNECTION);
    await client.connect();

    db = client.db(DB_NAME);
    testCollection = db.collection("test");

    col = new MongoCollectionReadWrite(testCollection, validator);
    await col.init(LogManager);
  });

  beforeEach(async () => {
    const docs = [
      { _id: new ObjectId(), name: "A", createdAt: new Date() },
      { _id: new ObjectId(), name: "B", createdAt: new Date() },
      { _id: new ObjectId(), name: "C", createdAt: new Date() },
    ];

    const result = await testCollection.insertMany(docs);
    insertedIds = Object.values(result.insertedIds);
  });

  afterEach(async () => {
    await testCollection.deleteMany({
      _id: { $in: insertedIds },
    });
  });

  afterAll(async () => {
    await client.close();
  });

  describe("create", () => {
    test("create() inserts a document and returns mapped result", async () => {
      const doc = new TestInfo();

      doc.setName("NewDoc");

      const result = await col.create(doc);

      expect(result).toHaveProperty("_id");
      expect(result.name).toBe("NewDoc");

      // Cleanup
      await testCollection.deleteOne({ _id: result._id });
    });
  });

  describe("update", () => {
    test("update() modifies a document", async () => {
      const id = insertedIds[0].toString();

      //const update = { name: "Updated", createdAt: new Date() };

      const update = new TestInfo();
      update._createdAt = new Date();
      update._id = undefined;
      update.setName("Updated Doc");

      const success = await col.update(id, update);
      expect(success).toBe(true);

      const updatedDoc = await col.read(id);
      expect(updatedDoc.name).toBe("Updated Doc");
    });
  });

  describe("delete", () => {
    test("delete() removes a document", async () => {
      const id = insertedIds[0].toString();

      const success = await col.delete(id);
      expect(success).toBe(true);

      const result = await col.read(id);
      expect(result).toBeNull();
    });
  });
});
