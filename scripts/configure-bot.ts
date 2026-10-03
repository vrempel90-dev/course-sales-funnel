import "dotenv/config";
import { Api } from "grammy";
async function main() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("Set TELEGRAM_BOT_TOKEN");
  const api = new Api(token);
  await api.setMyCommands([
    { command: "start", description: "Начать подбор обучения" },
    { command: "menu", description: "Главное меню" },
    { command: "id", description: "Узнать Telegram ID" },
  ]);
  const info = await api.getMe();
  console.info(`Bot configured: @${info.username}`);
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
