import Base from "../foundation/Base.js"
import log4js from "log4js";
import log4js_extend from "log4js-extend";

import fs from "fs";
import path from "path";

const logConfigPath = path.resolve("configuration/log4js.json");
const logConfig = JSON.parse(fs.readFileSync(logConfigPath, "utf-8"));

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
    init() {
        var instance = this;
        var logger = instance.logger;

        logger.info("Initializing LogManager ...");

        log4js.configure(logConfig);

        log4js_extend(log4js, {
            format: "@name(@file:@line:@column)"
        });

        logger.trace("LogManager initialized ...");

        super.init(this);
    }

    getLogger(logInstance) {
        var instance = this;
        var logger = instance.logger;

        const category =typeof logInstance == "object"? logInstance.constructor.name: logInstance;

        if (!category) {
            logger.trace("Requested logging category is not availables ... using category 'default' ...");
            category = "default";
        }

        logger.info("Returning logger for category '"+category+"' ... ");

        return log4js.getLogger(category);
    }
};

const Singleton = new LogManager();
Singleton.init();

export default Singleton;