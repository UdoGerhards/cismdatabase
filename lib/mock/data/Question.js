import MockBaseRunner from "./MockBaseRunner.js";
import { ObjectId } from "mongodb";
import { faker } from "@faker-js/faker";

class Question extends MockBaseRunner {
  #count;

  init(count, LogManager) {
    super.init(LogManager);
    const instance = this;
    instance.count = count;
    instance.logger.info("MockRunner is up and running ...");
  }

  async build(overAllRegister) {
    const instance = this;

    const questionObjects = new Array();
    const questionIDs = new Array();

    let idx = 0;

    for (idx = 0; idx < instance.count; idx++) {
      questionObjects.push(instance._createMock());
      questionIDs.push(questionObjects[idx]._id);
    }

    instance.logger.info(
      "Creating mocked objects in database '" + instance.collectionName + "'",
    );

    overAllRegister.set(instance.constructor.name, questionIDs);

    // Insert into database;
    await instance.collection.insertMany(questionObjects);
    instance.logger.info("done!");

    return overAllRegister;
  }

  async readNumber(count){
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

  _createMock() {
    const instance = this;

    instance.logger.info("Creating mocked question ...");

    return {
      _id: new ObjectId(),
      ID: 1,
      question: faker.lorem.word(255),
      correct: faker.lorem.word(1),
    };
  }
}

export default Question;
