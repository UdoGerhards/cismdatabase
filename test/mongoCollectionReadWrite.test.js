const { DB_STRING, DB_TEST_NAME } = require ("/config");
const MongoCollectionReadWrite = require("/lib/database/dao/MongoCollectionReadWrite");
const { MongoClient, ObjectId } = require ("mongodb");

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
    if (typeof doc.createdAT !== "object" || doc.createdAT === null) {
      throw new Error("Invalid createdAT");
    }
    return true;
  };

  beforeAll(async () => {
    client = new MongoClient(DB_STRING);
    await client.connect();

    db = client.db(DB_TEST_NAME);
    testCollection = db.collection("test");

    col = new MongoCollectionReadWrite(testCollection, validator);
  });

  beforeEach(async () => {
    const docs = [
      { _id: new ObjectId(), name: "A", createdAT: new Date() },
      { _id: new ObjectId(), name: "B", createdAT: new Date() },
      { _id: new ObjectId(), name: "C", createdAT: new Date() },
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
      const doc = { name: "NewDoc", createdAT: new Date() };

      const result = await col.create(doc);

      expect(result).toHaveProperty("id");
      expect(result.name).toBe("NewDoc");

      // Cleanup
      await testCollection.deleteOne({ _id: new ObjectId(result.id) });
    });
  });

  describe("update", () => {
    test("update() modifies a document", async () => {
      const id = insertedIds[0].toString();

      const update = { name: "Updated", createdAT: new Date() };

      const success = await col.update(id, update);
      expect(success).toBe(true);

      const updatedDoc = await col.read(id);
      expect(updatedDoc.name).toBe("Updated");
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
