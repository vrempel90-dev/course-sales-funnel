import "dotenv/config";
import { Api } from "grammy";
import { configureCommands } from "../src/bot/commands/configure";
import { runtimeConfig } from "../src/lib/config";
const config = runtimeConfig();
if (!config.TELEGRAM_BOT_TOKEN) throw new Error("Set TELEGRAM_BOT_TOKEN");
configureCommands(new Api(config.TELEGRAM_BOT_TOKEN))
  .then(() => console.info("Admin commands configured"))
  .catch(() => {
    console.error("Telegram command setup failed");
    process.exitCode = 1;
  });
