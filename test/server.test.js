
import { DB_CONNECTION, DB_NAME } from "../config.js";
import Server from "../lib/server/routes.js";

let server;
const PORT = 3000;

beforeAll(async () => {
  server = new Server(DB_NAME, DB_CONNECTION);
  await server.init();
  server.listen(PORT);
});

afterAll(async () => {
  return await server.close();
});

describe("Getting a new question obejct from server ", () => {
  test("POST /api/question", async () => {
    const res = await fetch(`http://127.0.0.1:${PORT}/api/question`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(res.status).toBe(200);

    const data = await res.json(); // 👈 WICHTIG

    expect(data).not.toBeNull();
    expect(data._id).toBeDefined();
    expect(typeof data._id).toBe("string");

    expect(data.question).toBeDefined();
    expect(typeof data.question).toBe("string");

    expect(data.answers).toBeDefined();
    expect(typeof data.answers).toBe("object");
    expect(data.answers.length).toBe(4);

    expect(data.correct).toBeDefined();
    expect(typeof data.correct).toBe("string");

  });




});
