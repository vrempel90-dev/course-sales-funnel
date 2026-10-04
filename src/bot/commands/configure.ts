import type { Api } from "grammy";
import { t } from "../../i18n";
export async function configureCommands(api: Api) {
  const commands = (language: "RU" | "KZ") => [
    { command: "admin", description: t("command.admin", language) },
    { command: "cancel", description: t("command.cancel", language) },
  ];
  await api.setMyCommands(commands("RU"));
  await api.setMyCommands(commands("RU"), { language_code: "ru" });
  await api.setMyCommands(commands("KZ"), { language_code: "kk" });
}
