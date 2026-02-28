import { ObjectId } from "mongodb";
import Base from "../../foundation/Base.js";

class MongoCollectionReadOnly extends Base {
  /** @type {import('mongodb').Collection} */
  collection;

  /**
   * @param {import('mongodb').Collection} collection
   */
  constructor(collection) {
    super();

    if (!collection || typeof collection.find !== "function") {
      throw new Error("Collection instance is required");
    }

    let instance = this;
    instance.collection = collection;
  }

  init(LogManager) {
    super.init(LogManager);
    let instance = this;
    instance.logger.debug(instance.constructor.name + " initialisiert!");
  }

  getById = async (id) => {
    try {
      let instance = this;
      instance.logger.debug("Getting question with ID ${id]");

      if (!ObjectId.isValid(id)) {
        throw new Error("Invalid ObjectId");
      }

      const docId = new ObjectId(id);

      instance.logger.debug("Getting question by ID: " + docId);

      const doc = await instance.collection.findOne({ _id: docId });

      if (!doc) {
        throw new Error(`Question with id ${docId} not found`);
      }

      instance.logger.debug("Result: ${doch}");

      // Optional: ObjectId → string (ich weiß, du bevorzugst das)
      return doc;
    } catch (err) {
      instance.logger.error(JSON.stringify(err));
    }
  };

  //FIND
  find = async (search) => {
    try {
      let instance = this;

      instance.logger.debug("Searching ");
      instance.logger.debug(JSON.stringify(search, null, 2));

      const docs = await instance.collection.find(search).toArray();
      return docs.map((d) => ({ id: d._id.toString(), ...d }));
    } catch (err) {
      instance.logger.error(JSON.stringify(err));
    }
  };

  // READ
  read = async (id) => {
    try {
      let instance = this;
      instance.logger.debug("Reading ID: " + id);
      const doc = await instance.collection.findOne({ _id: new ObjectId(id) });
      return doc ? { id: doc._id.toString(), ...doc } : null;
    } catch (err) {
      instance.logger.error(JSON.stringify(err));
    }
  };

  // READ ALL
  readAll = async (filter = {}) => {
    try {
      let instance = this;
      instance.logger.debug("Getting all records from database");

      const docs = await instance.collection.find(filter).toArray();
      return docs.map((d) => ({ id: d._id.toString(), ...d }));
    } catch (err) {
      instance.logger.error(JSON.stringify(err));
    }
  };

  /**
  readNumber = async (count) => {
    const docs = await this.collection
      .aggregate([
        { $sample: { size: count } },
        {
          $lookup: {
            from: "answer",
            localField: "ID",
            foreignField: "question",
            as: "answers",
          },
        },
      ])
      .toArray();

    if (count === 1 && docs.length > 0) {
      res = docs[0];
    } else if (count === 1 && docs.length === 0) {
      res = null;
    } else {
      res = docs.map((d) => ({ id: d._id.toString(), ...d }));
    }

    return res;
  };

  */

  readNumber = async (count) => {
    try {
      let instance = this;
      const docs = await instance.collection
        .aggregate([
          { $sample: { size: count } },

          {
            $lookup: {
              from: "answer",
              let: { qid: { $toString: "$_id" } }, // Question._id → String
              pipeline: [
                {
                  $match: {
                    $expr: {
                      $eq: ["$question_id", "$$qid"], // Answer.question_id (String)
                    },
                  },
                },
              ],
              as: "answers",
            },
          },
        ])
        .toArray();

      if (count === 1) {
        return docs.length > 0 ? docs[0] : null;
      }

      instance.logger.debug("Getting '" + count + "'  records from database!");

      return docs.map((d) => ({ id: d._id.toString(), ...d }));
    } catch (err) {
      instance.logger.error(JSON.stringify(err));
    }
  };

  aggregate = async (pipeline) => {
    try {
      let instance = this;
      instance.logger.debug("Getting aggregation: ");

      instance.logger.debug(JSON.stringify(pipeline, null, 2));

      const cursor = instance.collection.aggregate(pipeline);
      const docs = await cursor.toArray();

      return docs.map((d) => ({
        id: d._id.toString(),
        ...d,
      }));
    } catch (err) {
      instance.logger.error(JSON.stringify(err));
    }
  };
}

export default MongoCollectionReadOnly;
