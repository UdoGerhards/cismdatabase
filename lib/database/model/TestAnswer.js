import BaseModel from "./BaseModel.js";

class TestAnswer extends BaseModel {
  constructor(_id, userId, testId, questionId, answerId, correct, createAt) {
    super();

    const instance = this;
    instance.user_id = userId;
    instance.test_id = testId;
    instance.question_id = questionId;
    instance.answer_id = answerId;
    instance.correct = correct;
  }
  
  getUser() {
    const instance = this;
    return instance.user_id;
  }

  setUser(user_id) {
    const instance = this;
    instance.user_id = user_id;
  }

  getTest() {
    const instance = this;
    return instance.test_id;
  }
  setTest(test_id) {
    const instance = this;
    instance.test_id = test_id;
  }

  getQuestion() {
    const instance = this;
    return instance.question_id;
  }

  setQuestion(question_id) {
    const instance = this;
    instance.question_id = question_id;
  }

  getAnswer() {
    const instance = this;
    return instance.answer_id;
  }

  setAnswer(answer_id) {
    const instance = this;
    instance.answer_id = answer_id;
  }

  isCorrect() {
    const instance = this;
    return instance.correct;
  }

  setCorrect(correct) {
    const instance = this;
    instance.correct = correct;
  }
}

export default TestAnswer;
