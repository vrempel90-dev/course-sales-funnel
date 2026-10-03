import { InlineKeyboard } from "grammy";
import { Role } from "@prisma/client";
import { permitted, Section } from "../../services/auth";
export const sections: Record<Section, string> = {
  stats: "📊 Статистика",
  clients: "👥 Клиенты",
  courses: "📚 Курсы",
  categories: "🗂 Направления",
  rules: "🎯 Рекомендации",
  payments: "💳 Оплаты",
  access: "🎓 Доступы",
  requests: "💬 Запросы",
  staff: "👨‍💼 Администраторы",
  requisites: "💰 Реквизиты",
  settings: "⚙️ Настройки",
};
export function button(k: InlineKeyboard, text: string, data: string) {
  if (Buffer.byteLength(data, "utf8") > 64)
    throw new Error("callback_data exceeds 64 bytes");
  k.text(text, data);
  return k;
}
export function home(role: Role) {
  const k = new InlineKeyboard();
  for (const [section, label] of Object.entries(sections))
    if (permitted(role, section as Section))
      button(k, label, "a:menu:" + section).row();
  return button(k, "❌ Закрыть", "a:close");
}
export function back(k = new InlineKeyboard(), target = "a:home") {
  return button(k.row(), "⬅️ Назад", target)
    .row()
    .text("🏠 Главное меню", "a:home");
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
