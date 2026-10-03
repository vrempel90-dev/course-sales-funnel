import "dotenv/config";
import { Api } from "grammy";
import { runtimeConfig } from "../src/lib/config";
const config = runtimeConfig();
if (!config.TELEGRAM_BOT_TOKEN) throw new Error("Set TELEGRAM_BOT_TOKEN");
new Api(config.TELEGRAM_BOT_TOKEN)
  .setMyCommands([
    { command: "admin", description: "Админ-панель" },
    { command: "cancel", description: "Отменить действие" },
  ])
  .then(() => console.info("Admin commands configured"))
  .catch(() => {
    console.error("Telegram command setup failed");
    process.exitCode = 1;
  });
