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
    let instance = this;

    try {
      instance.logger.debug("Creating object in database: ");

      doc.init();

      if (
        typeof instance.#validator === "undefined" &&
        !instance.#validator(doc)
      ) {
        throw new Error("Validation failed for document");
      }

      instance.logger.debug(JSON.stringify(doc, null, 2));

      const result = await instance.collection.insertOne(doc);

      return { _id: result.insertedId.toString(), ...doc };
    } catch (err) {
      instance.logger.error(err);
    }
  };

  update = async (id, update) => {
    let instance = this;

    try {
      instance.logger.debug("Updating object with ID: " + id);
      instance.logger.debug(JSON.stringify(update, null, 2));

      if (!instance.#validator(update)) {
        throw new Error("Validation failed for update");
      }

      // 👉 Unterscheidung: dot-notation vs normales Objekt
      const hasDotNotation = Object.keys(update).some((key) =>
        key.includes("."),
      );

      let plain;

      if (hasDotNotation) {
        // 👉 KEIN JSON.parse → sonst Risiko für Struktur
        plain = update;
      } else {
        // 👉 Standardverhalten beibehalten
        plain = JSON.parse(JSON.stringify(update));
        delete plain._id;
      }

      const objectId = typeof id === "string" ? new ObjectId(id): id;

      instance.logger.debug("ID", id );
      instance.logger.debug("ID type: ", typeof id);  
      instance.logger.debug("Update object: ", update);
      instance.logger.debug("Update type: ", typeof update);
      instance.logger.debug("Plain update object: ", (JSON.stringify(plain, null, 2)));

      const result = await instance.collection.updateOne(
        { _id: objectId },
        { $set: plain },
      );

      instance.logger.debug("Update result: ", result);

      return result.modifiedCount === 1;
    } catch (err) {
      instance.logger.error(err);
    }
  };

  // DELETE
  delete = async (id) => {
    let instance = this;

    try {
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
