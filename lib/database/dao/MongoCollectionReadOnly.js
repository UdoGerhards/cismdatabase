import { ObjectId } from "mongodb";
import Base from "../../foundation/Base.js"

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

    this.collection = collection;
  }
  
  init(LogManager) {
    super.init(LogManager);
  }

  
  getById = async (id) => {
    if (!ObjectId.isValid(id)) {
      throw new Error("Invalid ObjectId");
    }

    const docId = new ObjectId(id);

    const doc = await this.collection.findOne({ _id: docId });

    if (!doc) {
      throw new Error(`Question with id ${docId} not found`);
    }

    // Optional: ObjectId → string (ich weiß, du bevorzugst das)
    return doc;
  };

  //FIND
  find = async (search) => {
    const docs = await this.collection.find(search).toArray();
    return docs.map((d) => ({ id: d._id.toString(), ...d }));
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
    const docs = await this.collection
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

    return docs.map((d) => ({ id: d._id.toString(), ...d }));
  };

  aggregate = async (aggregateObj) => {

    const docs = await this.collection.aggregate(aggregateObj);

    return docs.map((d) => ({ id: d._id.toString(), ...d }));

  }
}

export default MongoCollectionReadOnly;
