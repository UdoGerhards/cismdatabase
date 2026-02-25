import BaseModel from "./BaseModel.js";

class TestAnswer extends BaseModel {
  constructor(_id, testId, questionId, answerId, correct, createAt) {
    super();

    this.test_id = testId;
    this.question_id = questionId;
    this.answer_id = answerId;
    this.correct = correct;
  }

  getTest() {
    return this.test_id;
  }
  setTest(test_id) {
    this.test_id = test_id;
  }

  getQuestion() {
    return this.question_id;
  }

  setQuestion(question_id) {
    this.question_id = question_id;
  }

  getAnswer() {
    return this.answer_id;
  }

  setAnswer(answer_id) {
    this.answer_id = answer_id;
  }

  isCorrect() {
    return this.correct;
  }

  setCorrect(correct) {
    this.correct = correct;
  }
}

export default TestAnswer;
