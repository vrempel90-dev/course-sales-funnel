import { InlineKeyboard } from "grammy";
import { t } from "../../i18n";
import { Role, Language } from "@prisma/client";
import { permitted, Section } from "../../services/auth";
export const sections: Record<Section, string> = {
  stats: t("stats.title"),
  clients: t("clients.title"),
  courses: t("courses.title"),
  categories: t("categories.title"),
  tariffs: t("tariffs.title"),
  rules: t("rules.title"),
  funnel: t("funnel.title"),
  bonuses: t("bonuses.title"),
  payments: t("payments.title"),
  access: t("access.title"),
  requests: t("requests.title"),
  staff: t("staff.title"),
  requisites: t("requisites.title"),
  languages: t("languages.title"),
  settings: t("settings.title"),
  status: t("status.title"),
};
export function button(k: InlineKeyboard, text: string, data: string) {
  if (Buffer.byteLength(data, "utf8") > 64)
    throw new Error("callback_data exceeds 64 bytes");
  k.text(text, data);
  return k;
}
export function home(role: Role, language: Language = "RU") {
  const k = new InlineKeyboard();
  for (const section of Object.keys(sections))
    if (permitted(role, section as Section))
      button(k, t(section + ".title", language), "a:menu:" + section).row();
  return button(k, t("common.close", language), "a:close");
}
export function back(
  k = new InlineKeyboard(),
  target = "a:home",
  language: Language = "RU",
) {
  return button(k.row(), t("common.back", language), target)
    .row()
    .text(t("common.home", language), "a:home");
}
export function pager(
  k: InlineKeyboard,
  page: number,
  pages: number,
  callback: (page: number) => string,
) {
  k.row();
  if (page > 0) button(k, "⬅️", callback(page - 1));
  if (page < pages - 1) button(k, "➡️", callback(page + 1));
  return k;
}
