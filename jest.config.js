module.exports = {
  testEnvironment: "node",

  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
    "^@config/(.*)$": "<rootDir>/config/$1",
    "^@lib/(.*)$": "<rootDir>/lib/$1",
    "^@database/(.*)$": "<rootDir>/lib/database/$1",
    "^@dao/(.*)$": "<rootDir>/lib/database/dao/$1",
    "^@model/(.*)$": "<rootDir>/lib/database/model/$1",
    "^@server/(.*)$": "<rootDir>/lib/server/$1"
  },
};
