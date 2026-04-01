class Base {
  constructor() {
    let instance = this;

    instance.logger = null;
  }

  init(LogManager) {
    let instance = this;
    instance.logger = LogManager.getLogger(this);
    instance.logger.info("Logger initialized");
  }
}

export default Base;
