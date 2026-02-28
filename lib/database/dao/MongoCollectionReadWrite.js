import MongoCollectionReadOnly from "./MongoCollectionReadOnly.js";
import { ObjectId } from "mongodb";

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

  init(LogManager) {
    super.init(LogManager);
    let instance = this;
    instance.logger.debug(instance.constructor.name + " initialisiert!");
  }

  // CREATE
  create = async (doc) => {
    try {
      let instance = this;
      instance.logger.debug("Creating object in database: ");
      instance.logger.debug(JSON.stringify(doc, null, 2));

      if (!instance.#validator(doc)) {
        throw new Error("Validation failed for document");
      }

      const result = await instance.collection.insertOne(doc);
      return { id: result.insertedId.toString(), ...doc };
    } catch (err) {
      instance.logger.error(JSON.stringify(err));
    }
  };

  // UPDATE
  update = async (id, update) => {
    try {
      let instance = this;

      instance.logger.debug("Updating object with ID: " + id);
      instance.logger.debug(JSON.stringify(update, null, 2));

      if (!instance.#validator(update)) {
        throw new Error("Validation failed for update");
      }

      const result = await instance.collection.updateOne(
        { _id: new ObjectId(id) },
        { $set: update },
      );

      return result.modifiedCount === 1;
    } catch (err) {
      instance.logger.error(JSON.stringify(err));
    }
  };

  // DELETE
  delete = async (id) => {
    try {
      let instance = this;
      instance.logger.debug(
        "Deleting from object from database with ID: " + id,
      );

      const result = await this.collection.deleteOne({ _id: new ObjectId(id) });
      return result.deletedCount === 1;
    } catch (err) {
      instance.logger.error(JSON.stringify(err));
    }
  };
}

export default MongoCollectionReadWrite;
