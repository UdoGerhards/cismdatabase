class BaseModel {
  _id = null;
  _createdAt = null;

  getId() {
    return this._id;
  }

  setId(_id) {
    this._id = _id;
  }

  getCreateAt() {
    return this._createdAt;
  }
  setCreateAt(value) {
    this._createdAt = value;
  }

  init() {
    this._createdAt = new Date();
  }
}

export default BaseModel;
