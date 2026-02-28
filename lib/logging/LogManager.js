import Base from "../foundation/Base.js"
import log4js from "log4js";
import log4js_extend from "log4js-extend";

/**
 * Created by udogerhards on 27.12.18.
 */
class LogManager extends Base {

    constructor() {
        
        super();

        var instance = this;
        instance.configFile = null;
        instance.categories = null;
        instance.logger = log4js.getLogger("default");
    }

    /**
     * Initializes the logging system
     *
     * @param configFile
     * @returns {string}
     * @private
     */
    init(configFile) {
        var instance = this;
        var logger = instance.logger;

        logger.info("Initializing LogManager ...");

        configFile = configFile || instance.configFile;

        if (configFile) {
            instance.configFile = configFile;
        } else {
            let configFileName = "/configuration/log4js.json";
            let configFilePath = process.env.PWD;
            instance.configFile = configFilePath+"/"+configFileName;
        }

        instance.categories = require(instance.configFile)["categories"] || null;

        log4js.configure(instance.configFile);

        log4js_extend(log4js, {
            format: "@name(@file:@line:@column)"
        });

        logger.trace("LogManager initialized ...");

        super.init(this);
    }

    getLogger(logInstance) {
        var instance = this;
        var logger = instance.logger;

        if (!instance.categories) {
            instance.init();
        }

        var category = logInstance.constructor.name;

        if (!instance.categories[category]) {
            logger.trace("Requested logging category is not availables ... using category 'default' ...");
            category = "default";
        }

        logger.info("Returning logger for category '"+category+"' ... ");

        return log4js.getLogger(category);
    }
};

export default new LogManager();