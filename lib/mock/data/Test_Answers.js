import MockBaseRunner from "./MockBaseRunner.js";
import { ObjectId } from "mongodb";
import { faker } from "@faker-js/faker";

class Test_Answers extends MockBaseRunner {
  constructor() {
    super();

    const instance = this;

    instance.localQuestionIDs = new Map();
    instance.joinCollection = null;
  }

  init(LogManager) {
    super.init(LogManager);
  }

  setJoinCollection(joinCollection) {
    const instance = this;
    instance.joinCollection = joinCollection;
  }

  async build(overAllRegister) {
    const instance = this;

    const tstIDs = await instance.joinCollection.build(
      instance.localQuestionIDs,
    );

    const testIDs = Array.from(tstIDs.values())[0];
    let allAnswers = new Array();
    for (let idx = 0; idx < testIDs.length; idx++) {
      const testID = testIDs[idx];
      const answerSet = instance._buildAnswerSet(testID);
      allAnswers = allAnswers.concat(answerSet);
    }

    instance.logger.info(
      "Creating mocked objects in database '" + instance.collectionName + "'",
    );

    await instance.collection.insertMany(allAnswers);

    instance.logger.info("Done!");

    const answerIDs = new Array();
    allAnswers.map((answer) => {
      answerIDs.push(answer._id);
    });

    // Merge existing question IDs with new question IDs and set them to the global environment
    let allTestIDs = overAllRegister.get(
      instance.joinCollection.getCollectionName(),
    );
    if (Array.isArray(allTestIDs) && allTestIDs.length > 0) {
      allTestIDs = allTestIDs.concat(testIDs);
    } else {
      allTestIDs = testIDs;
    }

    overAllRegister.set(
      instance.joinCollection.getCollectionName(),
      allTestIDs,
    );

    // Set answer IDs
    overAllRegister.set(instance.constructor.name, answerIDs);

    return overAllRegister;
  }

  _buildAnswerSet(testID) {
    const letter = faker.lorem.word(1);

    const questionIDs = new Array();
    questionIDs.push(new ObjectId());
    questionIDs.push(new ObjectId());
    questionIDs.push(new ObjectId());
    questionIDs.push(new ObjectId());

    const answerIDs = new Array();
    answerIDs.push(new ObjectId());
    answerIDs.push(new ObjectId());
    answerIDs.push(new ObjectId());
    answerIDs.push(new ObjectId());

    return [
      {
        _id: new ObjectId(),
        _createdAt: new Date(),
        test_id: testID.toString(),
        question_id: questionIDs[0].toString(),
        answer_id: answerIDs[0].toString(),
        correct: true,
        createdAt: new Date(),
      },
      {
        _id: new ObjectId(),
        _createdAt: new Date(),
        test_id: testID.toString(),
        question_id: questionIDs[0].toString(),
        answer_id: answerIDs[0].toString(),
        correct: true,
        createdAt: new Date(),
      },
      {
        _id: new ObjectId(),
        _createdAt: new Date(),
        test_id: testID.toString(),
        question_id: questionIDs[0].toString(),
        answer_id: answerIDs[0].toString(),
        correct: false,
        createdAt: new Date(),
      },
      {
        _id: new ObjectId(),
        _createdAt: new Date(),
        test_id: testID.toString(),
        question_id: questionIDs[0].toString(),
        answer_id: answerIDs[0].toString(),
        correct: false,
        createdAt: new Date(),
      },
    ];
  }
}

export default Test_Answers;
