import { DB_CONNECTION, DB_NAME } from "#config";
import TelegramBot from "node-telegram-bot-api";
import Server from "./lib/server/routes.js";

const server = new Server(DB_NAME, DB_CONNECTION);
server.init();
//server.listen(3000);

// Ersetze diese Werte durch deine Daten
const token = process.env.TELEGRAM_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

const bot = new TelegramBot(token, { polling: false });

function sendStartupNotification() {
  const message = `🚀 *CISMDatabase gestartet!*\n\nDie Anwendung wurde erfolgreich hochgefahren.\nZeitpunkt: ${new Date().toLocaleString()}`;

  bot
    .sendMessage(chatId, message, { parse_mode: "Markdown" })
    .then(() => console.log("Start-Benachrichtigung gesendet."))
    .catch((err) => console.error("Fehler beim Senden:", err));
}
server.listen(3000, sendStartupNotification());