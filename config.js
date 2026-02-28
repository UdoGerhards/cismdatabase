/*
export const DB_TEST_NAME = "cism_test";
*/

const isJest = () => {
  return process.env.JEST_WORKER_ID !== undefined;
};

const db_connection = "mongodb+srv://udogerhards:Ie7rpiU96dAp1d76@cimsexams.zcovvz2.mongodb.net/?appName=cimsexams";
let db_name = "cism";

if (isJest) {

  db_name = "cism_test";

}

export const DB_CONNECTION =  db_connection;
export const DB_NAME = db_name;
