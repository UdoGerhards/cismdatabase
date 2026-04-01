import Question from "./Question.js";
import { ObjectId } from "mongodb";
import { faker } from "@faker-js/faker";

class Test extends Question {
  _createMock() {
    const instance = this;

    instance.logger.info("Creating mocked test ...");

    return {
      _id: new ObjectId(),
      _createdAt: new Date(),
      name: faker.lorem.word(20),
      wrong: 0,
      user: "0000-0000-0000-0000",
    };
  }
}

export default Test;
