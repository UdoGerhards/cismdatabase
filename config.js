const DB_STRING =
  "mongodb+srv://udogerhards:oQ9cvFIvVVWsXMS7@cimsexams.zcovvz2.mongodb.net/?appName=cimsexams";

const DB_TEST_NAME = "cism_test";

const isJest = () => {
  return process.env.JEST_WORKER_ID !== undefined;
};

const DB_NAME = "cism";

module.exports = {
  DB_STRING,
  DB_NAME,
  DB_TEST_NAME,
};
