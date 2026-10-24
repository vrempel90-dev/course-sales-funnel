import { randomUUID } from "node:crypto";
import type { Language, Prisma, PrismaClient } from "@prisma/client";
import { AppError } from "../lib/errors";
import { requireAdmin } from "./auth";
import { audit } from "./admin";
import { ru, kz, courseTitleKz } from "../bot/client/i18n";

// Text defaults remain identical to the original bot until an owner edits them.
// Course descriptions/prices/links are managed in the existing course/payment screens.
const extraRu = {
  selfTariffDetails: "🎓 Самостоятельный\n\nЧто входит:\n✅ Доступ к видеоурокам на 3 месяца для самостоятельного обучения\n✅ Методическое пособие по выбранному направлению\n✅ Общий чат учеников\n✅ Электронный или бумажный сертификат\n\nЧего НЕТ в этом тарифе:\n\n❌ Нет домашних заданий и их проверки, разбора видео с постановкой рук.\n❌ Нет обратной связи от автора курса или куратора.\n❌ Нет участия в живых Zoom-созвонах.\n❌ Нет доступа к личной консультации",
  curatorTariffDetails: "🎓 С куратором\n\nЧто входит:\n✅ Доступ к видеоурокам на 6 месяцев обучения\n✅ Методическое пособие по выбранному направлению\n✅ Общий чат учеников\n✅ Проверка домашних заданий и постановка рук:\nУченик записывает видео отработки техники на модели и отправляет куратору.\nКуратор детально разбирает ошибки: правильность нажима, угол постановки кисти, скорость и ритм движений.\n✅ Закрытый рабочий чат поддержки\n✅ Групповые онлайн-созвоны раз в 2 недели, где куратор разбирает сложные темы и отвечает на вопросы учеников\n✅ Проверка финального практического видео-зачёта\n✅ Электронный или бумажный сертификат\n\nЧего НЕТ в этом тарифе:\n\n❌ Блок «Продажи»\nГотовые скрипты переписки с клиентами и закрытия на абонементы\n❌ Блок «Личный бренд»\nРазбор и докрутка соцсетей/профилей ученика\n❌ Банк идей для Reels / Shorts: 30 готовых сценариев роликов для привлечения локальной аудитории",
  mentorshipTariffDetails: "🎓 Наставничество\n\nЧто входит:\n✅ Доступ к видеоурокам на 12 месяцев обучения\n✅ Методическое пособие по выбранному направлению\n✅ Общий чат учеников\n✅ Проверка домашних заданий и постановка рук:\nУченик записывает видео отработки техники на модели и отправляет куратору.\nКуратор детально разбирает ошибки: правильность нажима, угол постановки кисти, скорость и ритм движений.\n✅ Закрытый рабочий чат поддержки\n✅ Групповые онлайн-созвоны раз в 2 недели, где куратор разбирает сложные темы и отвечает на вопросы учеников\n✅ Проверка финального практического видео-зачёта\n✅ Электронный или бумажный сертификат\n✅ Блок «Продажи»\nГотовые скрипты переписки с клиентами и закрытия на абонементы.\n✅ Блок «Личный бренд»\nРазбор и докрутка соцсетей/профилей ученика.\n✅ Банк идей для Reels / Shorts: 30 готовых сценариев роликов для привлечения локальной аудитории.\n✅ Личная консультация",
  noPrograms: "Программы пока недоступны.",
  courseDescriptionKz: "Онлайн оқу бағдарламасы. Толық бағдарлама мен материалдарды әкімші курс карточкасында жаңарта алады.",
  bonusOpen: "Открыть",
  trainingLink: "🎓 Перейти к обучению",
  questionTooLong: "Сообщение слишком длинное. До 1500 символов.",
  kaspiNotReady: "Автоматическая проверка Kaspi пока не полностью настроена. Администратор уведомлён.",
  receiptAmountMismatch: "Сумма в чеке не совпадает со стоимостью выбранного тарифа.",
  receiptMerchantMismatch: "Чек выписан другому получателю.",
  receiptTooOld: "Этот чек слишком старый для текущей оплаты.",
  receiptFutureDate: "Дата или время чека некорректны.",
  callbackFailed: "Не удалось выполнить действие. Попробуйте ещё раз или вернитесь в главное меню.",
  whatsappMessage: "Здравствуйте! Хочу купить курс «{course}», тариф «{tariff}». Стоимость: {amount} ₽.",
  whatsappIntro: "🇷🇺 Покупка для России\n\n📚 {course}\n🎓 {tariff}\n\n💰 {amount} ₽\n\nНажмите кнопку ниже — откроется WhatsApp с уже заполненным сообщением для покупки курса.",
  whatsappButton: "💬 Купить в WhatsApp",
  kaspiInstruction: "1. Оплатите точную сумму по кнопке ниже.\n2. Вернитесь в бот и нажмите «Я оплатил(а)».\n3. Отправьте исходный фискальный чек Kaspi в формате PDF — бот проверит его автоматически.",
  kaspiPayButton: "💳 Оплатить {amount} ₸ через Kaspi",
  languageRu: "🇷🇺 Русский",
  languageKz: "🇰🇿 Қазақша",
};
const extraKz: typeof extraRu = {
  selfTariffDetails: "🎓 Самостоятельный\n\nЧто входит:\n✅ Доступ к видеоурокам на 3 месяца для самостоятельного обучения\n✅ Методическое пособие по выбранному направлению\n✅ Общий чат учеников\n✅ Электронный или бумажный сертификат\n\nЧего НЕТ в этом тарифе:\n\n❌ Нет домашних заданий и их проверки, разбора видео с постановкой рук.\n❌ Нет обратной связи от автора курса или куратора.\n❌ Нет участия в живых Zoom-созвонах.\n❌ Нет доступа к личной консультации",
  curatorTariffDetails: "🎓 С куратором\n\nЧто входит:\n✅ Доступ к видеоурокам на 6 месяцев обучения\n✅ Методическое пособие по выбранному направлению\n✅ Общий чат учеников\n✅ Проверка домашних заданий и постановка рук:\nУченик записывает видео отработки техники на модели и отправляет куратору.\nКуратор детально разбирает ошибки: правильность нажима, угол постановки кисти, скорость и ритм движений.\n✅ Закрытый рабочий чат поддержки\n✅ Групповые онлайн-созвоны раз в 2 недели, где куратор разбирает сложные темы и отвечает на вопросы учеников\n✅ Проверка финального практического видео-зачёта\n✅ Электронный или бумажный сертификат\n\nЧего НЕТ в этом тарифе:\n\n❌ Блок «Продажи»\nГотовые скрипты переписки с клиентами и закрытия на абонементы\n❌ Блок «Личный бренд»\nРазбор и докрутка соцсетей/профилей ученика\n❌ Банк идей для Reels / Shorts: 30 готовых сценариев роликов для привлечения локальной аудитории",
  mentorshipTariffDetails: "🎓 Наставничество\n\nЧто входит:\n✅ Доступ к видеоурокам на 12 месяцев обучения\n✅ Методическое пособие по выбранному направлению\n✅ Общий чат учеников\n✅ Проверка домашних заданий и постановка рук:\nУченик записывает видео отработки техники на модели и отправляет куратору.\nКуратор детально разбирает ошибки: правильность нажима, угол постановки кисти, скорость и ритм движений.\n✅ Закрытый рабочий чат поддержки\n✅ Групповые онлайн-созвоны раз в 2 недели, где куратор разбирает сложные темы и отвечает на вопросы учеников\n✅ Проверка финального практического видео-зачёта\n✅ Электронный или бумажный сертификат\n✅ Блок «Продажи»\nГотовые скрипты переписки с клиентами и закрытия на абонементы.\n✅ Блок «Личный бренд»\nРазбор и докрутка соцсетей/профилей ученика.\n✅ Банк идей для Reels / Shorts: 30 готовых сценариев роликов для привлечения локальной аудитории.\n✅ Личная консультация",
  noPrograms: "Бағдарламалар әзірге қолжетімсіз.",
  courseDescriptionKz: "Онлайн оқу бағдарламасы. Толық бағдарлама мен материалдарды әкімші курс карточкасында жаңарта алады.",
  bonusOpen: "Ашу",
  trainingLink: "🎓 Оқуға өту",
  questionTooLong: "Сұрақ тым ұзын. 1500 таңбаға дейін жазыңыз.",
  kaspiNotReady: "Автоматты Kaspi тексеруі әзірге толық бапталмаған. Әкімшіге хабар берілді.",
  receiptAmountMismatch: "Чектегі сома таңдалған тариф бағасына сәйкес келмейді.",
  receiptMerchantMismatch: "Чек басқа алушыға рәсімделген.",
  receiptTooOld: "Бұл чек тексеру мерзімінен ескі.",
  receiptFutureDate: "Чек күні дұрыс емес.",
  callbackFailed: "Әрекетті орындау мүмкін болмады. Қайта көріңіз немесе басты мәзірге оралыңыз.",
  whatsappMessage: "Здравствуйте! Хочу купить курс «{course}», тариф «{tariff}». Стоимость: {amount} ₽.",
  whatsappIntro: "🇷🇺 Покупка для России\n\n📚 {course}\n🎓 {tariff}\n\n💰 {amount} ₽\n\nНажмите кнопку ниже — откроется WhatsApp с уже заполненным сообщением для покупки курса.",
  whatsappButton: "💬 Купить в WhatsApp",
  kaspiInstruction: "1. Төмендегі батырма арқылы нақты соманы төлеңіз.\n2. Ботқа оралып, «Төледім» батырмасын басыңыз.\n3. Kaspi-дің түпнұсқа фискалдық PDF-чегін жіберіңіз — бот оны автоматты түрде тексереді.",
  kaspiPayButton: "💳 {amount} ₸ Kaspi арқылы төлеу",
  languageRu: "🇷🇺 Русский",
  languageKz: "🇰🇿 Қазақша",
};
type ExtraKey = keyof typeof extraRu;
export type BotCopy = typeof ru & Record<ExtraKey, string> & Record<string, string>;
const courseNames = Object.fromEntries(
  Object.entries(courseTitleKz).map(([slug, title]) => ["courseTitle." + slug, title]),
);
export const defaultBotCopy: Record<"RU" | "KZ", BotCopy> = {
  RU: { ...ru, ...extraRu },
  KZ: { ...kz, ...extraKz, ...courseNames },
};
export function copyLanguage(language: Language | null | undefined): "RU" | "KZ" {
  return language === "KZ" ? "KZ" : "RU";
}
export function copyKeys(language: "RU" | "KZ"): string[] {
  return Object.keys(defaultBotCopy[language]);
}
export function copyKey(language: "RU" | "KZ", index: string): string {
  if (!/^\d{1,3}$/.test(index)) throw new AppError("Неизвестный текст");
  const key = copyKeys(language)[Number(index)];
  if (!key) throw new AppError("Неизвестный текст");
  return key;
}
const settingKey = (language: "RU" | "KZ") => "bot.copy." + language;
function overrides(value: Prisma.JsonValue | undefined): Record<string, string> {
  if (!value || Array.isArray(value) || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value).filter(([key, val]) =>
      typeof val === "string" && val.trim() && val.length <= 3500 &&
      !key.startsWith("__")),
  ) as Record<string, string>;
}
export async function botCopy(
  db: Pick<PrismaClient, "setting">,
  language: Language | null | undefined,
): Promise<BotCopy> {
  const lang = copyLanguage(language);
  const saved = await db.setting.findUnique({ where: { key: settingKey(lang) } });
  const defaults = defaultBotCopy[lang];
  const safe = Object.fromEntries(
    Object.entries(overrides(saved?.value)).filter(([key]) => Object.hasOwn(defaults, key)),
  );
  return { ...defaults, ...safe };
}
export function fillText(source: string, variables: Record<string, string>): string {
  return source.replace(/\{([a-z]+)\}/g, (whole, key: string) =>
    Object.hasOwn(variables, key) ? variables[key] : whole,
  );
}
const shortTexts = new Set([
  "goalProfessional", "goalFamily", "goalBeauty", "beginner", "basicExperience",
  "professionalBonus", "familyBonus", "nails", "hair", "depilation", "lashes",
  "beautyBonus", "buy", "ask", "trial", "paid", "mainMenu", "chooseTraining",
  "myCourses", "language", "back", "kz", "ruCountry", "bonusOpen",
  "trainingLink", "whatsappButton", "kaspiPayButton", "languageRu", "languageKz",
]);
function validateText(key: string, value: string) {
  if (!value.trim()) throw new AppError("Текст не может быть пустым");
  if (value.length > 3500) throw new AppError("Максимум 3500 символов");
  if (shortTexts.has(key) && value.length > 60)
    throw new AppError("Для кнопки допускается не более 60 символов");
}
export async function startCopyEdit(
  db: PrismaClient, adminId: string, language: "RU" | "KZ", key: string,
) {
  await requireAdmin(db, adminId, "copy", true);
  if (!Object.hasOwn(defaultBotCopy[language], key))
    throw new AppError("Неизвестный текст");
  await db.adminConversationState.upsert({
    where: { adminId },
    create: {
      adminId, flowType: "botcopy", nonce: randomUUID(),
      payload: { language, key }, expiresAt: new Date(Date.now() + 3600000),
    },
    update: {
      flowType: "botcopy", step: 0, nonce: randomUUID(),
      payload: { language, key }, expiresAt: new Date(Date.now() + 3600000),
    },
  });
}
export async function saveCopyMessage(
  db: PrismaClient, adminId: string, text: string | undefined, updateId: number,
) {
  if (typeof text !== "string") throw new AppError("Пришлите текстовое сообщение");
  return db.$transaction(async (tx) => {
    await requireAdmin(tx, adminId, "copy", true);
    const state = await tx.adminConversationState.findUnique({ where: { adminId } });
    if (!state || state.flowType !== "botcopy" || state.expiresAt < new Date())
      throw new AppError("Редактирование устарело. Откройте текст заново.");
    const { language, key } = state.payload as { language?: "RU" | "KZ"; key?: string };
    if (!language || !key || !Object.hasOwn(defaultBotCopy[language] ?? {}, key))
      throw new AppError("Неизвестный текст");
    validateText(key, text);
    const deleted = await tx.adminConversationState.deleteMany({
      where: { adminId, nonce: state.nonce, flowType: "botcopy" },
    });
    if (!deleted.count) throw new AppError("Это сообщение уже обработано");
    const original = await tx.setting.findUnique({ where: { key: settingKey(language) } });
    const before = overrides(original?.value);
    const next = { ...before, [key]: text };
    await tx.setting.upsert({
      where: { key: settingKey(language) },
      create: { key: settingKey(language), value: next },
      update: { value: next },
    });
    await audit(tx, adminId, "BOT_COPY_UPDATED", "Setting", settingKey(language), {
      key, language, updateId, before: before[key] ?? null, after: text,
    });
    return { language, key };
  });
}
export async function resetCopy(
  db: PrismaClient, adminId: string, language: "RU" | "KZ", key: string,
) {
  await db.$transaction(async (tx) => {
    await requireAdmin(tx, adminId, "copy", true);
    if (!Object.hasOwn(defaultBotCopy[language] ?? {}, key))
      throw new AppError("Неизвестный текст");
    const stored = await tx.setting.findUnique({ where: { key: settingKey(language) } });
    const data = overrides(stored?.value);
    const previous = data[key];
    delete data[key];
    await tx.setting.upsert({
      where: { key: settingKey(language) },
      create: { key: settingKey(language), value: data },
      update: { value: data },
    });
    await audit(tx, adminId, "BOT_COPY_RESET", "Setting", settingKey(language), {
      key, language, before: previous ?? null,
    });
  });
}
