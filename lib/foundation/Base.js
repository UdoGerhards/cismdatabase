
class Base {

    constructor() {

        let  instance = this;

        instance.logger = null;

    }

    init(LogManager) {

        let instance = this;

        instance.logger = LogManager.getLogger(this);
        instance.logger.debug("Logger initilized");
    }
}

export default Base;