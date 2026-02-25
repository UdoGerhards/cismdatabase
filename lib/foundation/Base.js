
class Base {

    constructor() {

        this.logger = null;

    }

    init(LogManager) {

        this.logger = LogManager.getLogger(this);
    }
}

export default Base;