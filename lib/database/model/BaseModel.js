class BaseModel {
  _id = null;
  _createdAt = null;

  getId() {
    const instance = this;
    return instance._id;
  }

  setId(_id) {
    const instance = this;
    instance._id = _id;
  }

  getCreateAt() {
    const instance = this;
    return instance._createdAt;
  }

  setCreateAt(value) {
    const instance = this;
    instance._createdAt = value;
  }

  init() {
    const instance = this;
    instance._createdAt = new Date();
  }
}

export default BaseModel;
