class Base {
  _id = null;
  _createAt = null;

  getId() {
    return this._id;
  }

  setId(_id) {
    this._id = _id;
  }

  getCreateAt() {
    return this._createAt;
  }
  setCreateAt(value) {
    this._createAt = value;
  }

  init() {
    this._createAt = new Date();
  }
}

module.exports = Base;
