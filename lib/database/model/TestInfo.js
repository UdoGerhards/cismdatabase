import BaseModel from "./BaseModel.js";

class TestInfo extends BaseModel {
  constructor(name) {
    super();

    this.name = name;
    this.correct = 0;
    this.wrong = 0;
    this.user = "000-0000-0000-0000";
  }

  getName() {
    return this.name;
  }

  setName(name) {
    this.name = name;
  }

  setCorrect(count) {
    this.correct = count;
  }

  getCorrect() {
    return this.correct;
  }

  setWrong(count) {
    this.wrong = count;
  }

  getWrong() {
    return this.wrong;
  }

  setUser(user) {
    this.user = user;
  }

  getUser() {
    return this.user;
  }
}

export default TestInfo;
