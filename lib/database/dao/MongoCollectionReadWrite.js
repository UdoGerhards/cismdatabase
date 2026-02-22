const MongoCollectionReadOnly =require("../dao/MongoCollectionReadOnly");
const { ObjectId } = require("mongodb");

class MongoCollectionReadWrite extends MongoCollectionReadOnly {

  /** @type {(doc: any) => boolean} */
  #validator;

  /**
   * @param {import('mongodb').Collection} collection
   * @param {(doc: any) => boolean} validator  Function that returns true if doc is valid
   */
  constructor(collection, validator = () => true) {

    super(collection);

    if (typeof validator !== "function") {
      throw new Error("Validator must be a function");
    }

    this.#validator = validator;
  }

  // CREATE
  create = async (doc) => {
    if (!this.#validator(doc)) {
      throw new Error("Validation failed for document");
    }

    const result = await this.collection.insertOne(doc);
    return { id: result.insertedId.toString(), ...doc };
  };

  // READ
  read = async (id) => {
    const doc = await this.collection.findOne({ _id: new ObjectId(id) });
    return doc ? { id: doc._id.toString(), ...doc } : null;
  };

  // READ ALL
  readAll = async (filter = {}) => {
    const docs = await this.collection.find(filter).toArray();
    return docs.map((d) => ({ id: d._id.toString(), ...d }));
  };

  // UPDATE
  update = async (id, update) => {
    if (!this.#validator(update)) {
      throw new Error("Validation failed for update");
    }

    const result = await this.collection.updateOne(
      { _id: new ObjectId(id) },
      { $set: update },
    );

    return result.modifiedCount === 1;
  };

  // DELETE
  delete = async (id) => {
    const result = await this.collection.deleteOne({ _id: new ObjectId(id) });
    return result.deletedCount === 1;
  };
}

module.exports = MongoCollectionReadWrite;
