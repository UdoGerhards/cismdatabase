import Base from "../foundation/Base.js";
import LogManager from "../logging/LogManager.js";
import { MongoClient, ObjectId } from "mongodb";

class MockExecutor extends Base {
  constructor() {
    super();
    const instance = this;

    instance.overallRegister = new Map();
    instance.mockRunner = Array();
  }

  init = async (DB_CONNECTION, DB_NAME) => {
    super.init(LogManager);
    const instance = this;

    instance.client = new MongoClient(DB_CONNECTION);
    await instance.client.connect();

    instance.database = instance.client.db(DB_NAME);
    instance.logger.info("MockExecutor is up and running ... ");
  };

  close = async () => {
    const instance = this;
    await instance.client.close();
  };

  add = async (mockRunner) => {
    try {
      const instance = this;

      const runner = mockRunner.constructor.name; // Classname of runner names the target collection
      const targetCollection = instance.database.collection(
        runner.toLowerCase()
      );

      mockRunner.setCollection(targetCollection);
      instance.logger.info("Adding ${mockRunner} to runner stack ... ");

      instance.mockRunner.push(mockRunner);
    } catch (error) {
      instance.logger.error(error);
    }
  };

  build = async () => {
    const instance = this;
    instance.logger.info("Start mocking ...");
    for (const runner of instance.mockRunner) {
      instance.overallRegister = await runner.build(instance.overallRegister);
    }

    return instance.overallRegister;
  };

  clean = async () => {
    const instance = this;

    instance.logger.info("Cleaning up ...");
    for (const runner of instance.mockRunner) {
      instance.logger.debug(runner);
      await runner.clean();
    }
  };
}

export default new MockExecutor();
