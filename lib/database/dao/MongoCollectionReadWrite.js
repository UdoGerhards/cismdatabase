import { ObjectId } from "mongodb";
import MongoCollectionReadOnly from "./MongoCollectionReadOnly.js";

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
        typeof instance.#validator !== "undefined" &&
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

  createMany = async (docs) => {
    let instance = this;

    try {
      if (!Array.isArray(docs) || docs.length === 0) {
        return [];
      }

      instance.logger.debug(`Creating ${docs.length} objects in database.`);

      // 1. Dokumente vorbereiten und validieren
      for (const doc of docs) {
        // Initialisierung (z.B. Timestamps, Defaults setzen)
        if (typeof doc.init === "function") {
          doc.init();
        }

        // Validierung pro Dokument
        if (
          typeof instance.#validator !== "undefined" &&
          !instance.#validator(doc)
        ) {
          throw new Error(`Validation failed for a document in the batch`);
        }
      }

      // 2. Batch-Einfügung in die Collection
      const result = await instance.collection.insertMany(docs);

      instance.logger.debug(
        `Successfully inserted ${result.insertedCount} documents.`,
      );

      // 3. Dokumente mit ihren neuen IDs zurückgeben
      // MongoDB gibt result.insertedIds als Objekt { index: ObjectId } zurück
      return docs.map((doc, index) => ({
        _id: result.insertedIds[index].toString(),
        ...doc,
      }));
    } catch (err) {
      instance.logger.error("Error during insertMany:");
      instance.logger.error(err);
      throw err; // Fehler weiterreichen, damit der Aufrufer (z.B. das Error-Logging) Bescheid weiß
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

      const objectId = typeof id === "string" ? new ObjectId(id) : id;

      instance.logger.debug("ID", id);
      instance.logger.debug("ID type: ", typeof id);
      instance.logger.debug("Update object: ", update);
      instance.logger.debug("Update type: ", typeof update);
      instance.logger.debug(
        "Plain update object: ",
        JSON.stringify(plain, null, 2),
      );

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

  deleteMany = async (filter) => {
    let instance = this;

    try {
      instance.logger.debug(
        "Deleting multiple objects from database with filter: " +
          JSON.stringify(filter),
      );

      // Führt die Löschung basierend auf dem übergebenen Filter aus
      const result = await this.collection.deleteMany(filter);

      // Gibt die Anzahl der gelöschten Dokumente zurück
      return {
        success: true,
        deletedCount: result.deletedCount,
      };
    } catch (err) {
      instance.logger.error("Error in deleteMany: " + JSON.stringify(err));
      throw err; // Fehler werfen, damit der aufrufende Service ihn behandeln kann
    }
  };
}

export default MongoCollectionReadWrite;
