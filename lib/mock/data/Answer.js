import MockBaseRunner from './MockBaseRunner.js';
import { ObjectId } from "mongodb";
import { faker } from "@faker-js/faker";

class Answer extends MockBaseRunner {
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

    const questIDS = await instance.joinCollection.build(instance.localQuestionIDs);

    const questionIDs = Array.from(questIDS.values())[0];
    let allAnswers = new Array();
    for (let idx = 0; idx < questionIDs.length; idx++) {
      const questionID = questionIDs[idx];
      const answerSet = instance._buildAnswerSet(questionID);
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
    let allQuestionIDs = overAllRegister.get(instance.joinCollection.getCollectionName());
    if (Array.isArray(allQuestionIDs) && allQuestionIDs.length > 0) {
      allQuestionIDs = allQuestionIDs.concat(questionIDs);
    } else {
      allQuestionIDs = questionIDs;
    }

    overAllRegister.set(instance.joinCollection.getCollectionName(), allQuestionIDs);

    // Set answer IDs
    overAllRegister.set(instance.constructor.name, answerIDs);

    return overAllRegister;
  }

  _buildAnswerSet(questionID) {
    const letter = faker.lorem.word(1);

    return [
      {
        _id: new ObjectId(),
        question: letter,
        answer: faker.lorem.word(1),
        text: faker.lorem.word(50),
        question_id: questionID.toString(),
      },
      {
        _id: new ObjectId(),
        question: letter,
        answer: faker.lorem.word(1),
        text: faker.lorem.word(50),
        question_id: questionID.toString(),
      },
      {
        _id: new ObjectId(),
        question: letter,
        answer: faker.lorem.word(1),
        text: faker.lorem.word(50),
        question_id: questionID.toString(),
      },
      {
        _id: new ObjectId(),
        question: letter,
        answer: faker.lorem.word(1),
        text: faker.lorem.word(50),
        question_id: questionID.toString(),
      },
    ];
  }
}

export default Answer;
