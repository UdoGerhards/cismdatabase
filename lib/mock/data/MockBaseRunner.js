class MockBaseRunner {
  constructor(collection) {
    if (new.target === MockBaseRunner) {
      throw new Error(
        "MockBaseRunner is abstract and cannot be instantiated directly.",
      );
    }

    const instance = this;
    instance.collection = collection;
    instance.collectionName = null;
    instance.logger = null;
  }

  init(LogManager) {
    const instance = this;

    const classname = instance.constructor.name;
    instance.logger = LogManager.getLogger("Mock"+classname);

    instance.logger.info(`${classname} up and running ...`);
    instance.logger.info("Logger initialized");
  }

  setCollection(collection) {
    const instance = this;
    instance.collection = collection;
    instance.collectionName = collection.collectionName;
  }
  
  getCollectionName() {
    const instance = this;
    return instance.collectionName;
  }

  async build() {
    const instance = this;
    instance.logger.error("Call to undefined function! ");
    throw new Error("build() must be implemented by subclass");
  }

  async clean() {
    const instance = this;
    instance.logger.info("Cleaning "+instance.collectionName)+" ...";
    await instance.collection.deleteMany({});
  }
}

export default MockBaseRunner;
