import BaseModel from "./BaseModel.js";

class TestInfo extends BaseModel {
  constructor(name) {
    super();

    const instance = this;

    instance.user_id = null;
    instance.name = name;
    instance.correct = 0;
    instance.wrong = 0;
  }

  getUser() {
    const instance = this;
    return instance.user_id;
  }

  setUser(user_id) {
    const instance = this;
    instance.user_id = user_id;
  }

  getName() {
    const instance = this;
    return instance.name;
  }

  setName(name) {
    const instance = this;
    instance.name = name;
  }

  setCorrect(count) {
    const instance = this;
    instance.correct = count;
  }

  getCorrect() {
    const instance = this;
    return instance.correct;
  }

  setWrong(count) {
    const instance = this;
    instance.wrong = count;
  }

  getWrong() {
    const instance = this;
    return instance.wrong;
  }
}

export default TestInfo;
