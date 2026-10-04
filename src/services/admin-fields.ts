import type { Entity } from "./admin";
export type Field = {
  key: string;
  label: string;
  type:
    | "text"
    | "number"
    | "money"
    | "bool"
    | "choice"
    | "category"
    | "course"
    | "tariff"
    | "cover"
    | "demo"
    | "media";
  options?: string[];
  nullable?: boolean;
  max?: number;
};
const f = (
  key: string,
  type: Field["type"] = "text",
  extra: Partial<Field> = {},
): Field => ({ key, label: "field." + key, type, ...extra });
const ruField = (key: string, max = 120, nullable = true) =>
  f(key, "text", { nullable, max, label: "field." + key + "RU" });
const optional = (key: string, max = 120) =>
  f(key, "text", { nullable: true, max });
const choice = (key: string, options: string[], nullable = false) =>
  f(key, "choice", { options, nullable });
const experience = () =>
  choice(
    "experienceLevel",
    [
      "BEGINNER",
      "HAS_BASIC_EXPERIENCE",
      "PRACTICING",
      "PROFESSIONAL",
      "UPSKILLING",
    ],
    true,
  );
const goal = () =>
  choice("primaryGoal", ["PROFESSIONAL", "FAMILY", "BEAUTY"], true);
const family = () =>
  choice(
    "familyProblem",
    ["BACK_NECK", "LEGS_SWELLING_FATIGUE", "HOME_RELAXATION"],
    true,
  );
const beauty = () =>
  choice(
    "beautyProfession",
    ["NAILS", "HAIR", "DEPILATION", "LASH_BROW_COSMETOLOGY"],
    true,
  );
const learning = () =>
  choice(
    "learningGoal",
    ["NEW_PROFESSION", "NEW_SERVICE", "PERSONAL", "UPSKILLING"],
    true,
  );
export const fields: Record<Entity | "reject" | "search", Field[]> = {
  category: [
    f("title"),
    optional("titleKZ"),
    optional("description", 1000),
    optional("descriptionKZ", 1000),
    f("active", "bool"),
    f("sortOrder", "number"),
  ],
  course: [
    f("categoryId", "category"),
    ruField("title", 120, false),
    optional("titleKZ"),
    ruField("shortDescription", 300),
    optional("shortDescriptionKZ", 300),
    ruField("fullDescription", 1200),
    optional("fullDescriptionKZ", 1200),
    ruField("program", 1200),
    optional("programKZ", 1200),
    ruField("duration"),
    optional("durationKZ"),
    f("cover", "cover"),
    f("demo", "demo"),
    optional("telegramChannelId"),
    choice("status", ["DRAFT", "ACTIVE", "HIDDEN", "ARCHIVED"]),
    f("active", "bool"),
    f("sortOrder", "number"),
  ],
  tariff: [
    f("courseId", "course"),
    f("code"),
    f("title"),
    optional("titleKZ"),
    optional("description", 1200),
    f("priceKZT", "money"),
    f("priceRUB", "money"),
    f("active", "bool"),
    f("sortOrder", "number"),
  ],
  ct: [
    optional("title"),
    optional("shortDescription", 300),
    optional("fullDescription", 1200),
    optional("program", 1200),
    optional("duration"),
  ],
  kt: [optional("title"), optional("description", 1000)],
  tt: [optional("title"), optional("description", 1200)],
  bt: [
    optional("title"),
    optional("description", 1200),
    optional("buttonText"),
  ],
  funnel: [optional("text", 3900), f("active", "bool")],
  bonus: [
    f("code"),
    choice("targetSegment", ["PROFESSIONAL", "FAMILY", "BEAUTY"]),
    choice("type", ["VIDEO", "DOCUMENT", "CHECKLIST", "URL"]),
    f("media", "media"),
    f("active", "bool"),
  ],
  rule: [
    goal(),
    experience(),
    family(),
    beauty(),
    f("categoryId", "category", { nullable: true }),
    learning(),
    f("courseId", "course"),
    f("priority", "number"),
    f("active", "bool"),
  ],
  admin: [
    f("telegramId"),
    f("name"),
    choice("role", ["ADMIN", "MANAGER"]),
    choice("language", ["RU", "KZ"]),
  ],
  client: [
    f("firstName"),
    optional("lastName"),
    optional("phone", 40),
    choice("language", ["RU", "KZ"]),
    goal(),
    experience(),
    family(),
    beauty(),
    f("categoryId", "category", { nullable: true }),
    learning(),
    f("selectedCourseId", "course", { nullable: true }),
    f("selectedTariffId", "tariff", { nullable: true }),
    choice("currentFunnelStage", [
      "NEW",
      "TELEGRAM_STARTED",
      "QUESTIONNAIRE_STARTED",
      "QUESTIONNAIRE_COMPLETED",
      "COURSE_RECOMMENDED",
      "DEMO_VIEWED",
      "COURSE_SELECTED",
      "PAYMENT_STARTED",
      "WAITING_PAYMENT",
      "PAYMENT_REVIEW",
      "PAID",
      "ACCESS_GRANTED",
      "MANAGER_REQUESTED",
    ]),
  ],
  settings: [
    f("projectName"),
    f("supportUsername"),
    f("adminNotifications", "bool"),
    f("remindersEnabled", "bool"),
    f("funnelDelayHours", "number"),
    f("demoDelayHours", "number"),
    f("paymentDelayHours", "number"),
    f("reminderMaxAttempts", "number"),
    f("inviteLifetimeHours", "number"),
    f("expertContact"),
    f("trialEnabled", "bool"),
    f("trialDescriptionRU", "text", { max: 1200 }),
    f("trialDescriptionKZ", "text", { max: 1200 }),
    f("trialContactUsername"),
    optional("trialBookingUrl", 500),
    f("trialNotificationAdmins"),
  ],
  requisites: [
    f("title"),
    f("instruction", "text", { max: 1200 }),
    f("requisites", "text", { max: 1200 }),
    f("enabled", "bool"),
  ],
  reject: [f("reason", "text", { max: 1000 })],
  search: [f("query", "text", { max: 120 })],
};
