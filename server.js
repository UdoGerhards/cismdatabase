import "./env.js"
import { DB_CONNECTION, DB_NAME } from "#config";
import Server from "./lib/server/routes.js"

const server = new Server(DB_NAME, DB_CONNECTION);
server.init();
server.listen(3000);