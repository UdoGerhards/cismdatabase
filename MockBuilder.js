import { DB_CONNECTION, DB_NAME } from "#config";
import MockExecutor from "./lib/mock/MockExecutor.js";
import Question from "./lib/mock/data/Question.js";
import Test from "./lib/mock/data/Test.js";
import Answer from "./lib/mock/data/Answer.js";
import Test_Answers from "./lib/mock/data/Test_Answers.js";
import LogManager from "./lib/logging/LogManager.js";

await MockExecutor.init(DB_CONNECTION, DB_NAME);

// Mock standing alone question objects

// Single question (10)
const questions = new Question();
questions.init(10, LogManager);
MockExecutor.add(questions);

const answer = new Answer();
answer.setJoinCollection(questions);
answer.init(LogManager);
MockExecutor.add(answer);

// Single tests (10)
const tests = new Test();
tests.init(10, LogManager);
MockExecutor.add(tests);

const test_answers = new Test_Answers();
test_answers.setJoinCollection(tests);
test_answers.init(LogManager);
MockExecutor.add(test_answers);

await MockExecutor.build();

const shutdown = async (signal) => {
  try {
    console.log(`\nReceived ${signal}. Cleaning database ...`);

    await MockExecutor.clean();
    await MockExecutor.close();

    console.log("Cleanup complete. Exiting.");
    process.exit(0);
  } catch (err) {
    console.error("Error during shutdown:", err);
    process.exit(1);
  }
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
