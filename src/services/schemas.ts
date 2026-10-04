import { t } from "../i18n";
import { z } from "zod";
export const title = z.string().trim().min(1).max(120);
const httpUrl = z
  .url()
  .max(500)
  .refine((v) => /^https?:\/\//.test(v), "HTTP(S) URL required");
const id = z.string().min(1).max(40);
export const money = z.string().regex(/^\d{1,9}(\.\d{1,2})?$/);
const nullable = z.string().trim().max(500).nullable();
export const categorySchema = z.object({
  title,
  titleKZ: z.string().trim().max(120).nullable().default(null),
  descriptionKZ: z.string().trim().max(1000).nullable().default(null),
  description: z.string().trim().max(1000).nullable().default(null),
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(100000),
});
export const courseSchema = z.object({
  title,
  titleKZ: z.string().trim().max(120).nullable().default(null),
  shortDescriptionKZ: z.string().trim().max(300).nullable().default(null),
  fullDescriptionKZ: z.string().trim().max(1200).nullable().default(null),
  programKZ: z.string().trim().max(1200).nullable().default(null),
  durationKZ: z.string().trim().max(120).nullable().default(null),
  shortDescription: z
    .string()
    .trim()
    .max(300)
    .nullable()
    .transform((v) => v ?? ""),
  fullDescription: z
    .string()
    .trim()
    .max(1200)
    .nullable()
    .transform((v) => v ?? ""),
  categoryId: id,
  program: z
    .string()
    .trim()
    .max(1200)
    .nullable()
    .transform((v) => v ?? ""),
  duration: z
    .string()
    .trim()
    .max(120)
    .nullable()
    .transform((v) => v ?? ""),
  active: z.boolean().default(true),
  imageFileId: nullable.default(null),
  imageFileType: z.enum(["photo", "document"]).nullable().default(null),
  imageUrl: httpUrl.nullable().default(null),
  demoFileId: nullable.default(null),
  demoFileType: z.enum(["video", "document"]).nullable().default(null),
  demoVideoUrl: httpUrl.nullable().default(null),
  telegramChannelId: z
    .string()
    .regex(/^(?:-100\d{5,15}|@[A-Za-z][A-Za-z0-9_]{4,31})$/)
    .nullable(),
  status: z.enum(["DRAFT", "ACTIVE", "HIDDEN", "ARCHIVED"]),
  sortOrder: z.number().int().min(0).max(100000).default(0),
});
export const primaryGoal = z
  .enum(["PROFESSIONAL", "FAMILY", "BEAUTY"])
  .nullable();
export const familyProblem = z
  .enum(["BACK_NECK", "LEGS_SWELLING_FATIGUE", "HOME_RELAXATION"])
  .nullable();
export const beautyProfession = z
  .enum(["NAILS", "HAIR", "DEPILATION", "LASH_BROW_COSMETOLOGY"])
  .nullable();
export const ruleSchema = z.object({
  primaryGoal: primaryGoal.default(null),
  familyProblem: familyProblem.default(null),
  beautyProfession: beautyProfession.default(null),
  experienceLevel: z
    .enum([
      "BEGINNER",
      "HAS_BASIC_EXPERIENCE",
      "PRACTICING",
      "PROFESSIONAL",
      "UPSKILLING",
    ])
    .nullable(),
  categoryId: id.nullable(),
  learningGoal: z
    .enum(["NEW_PROFESSION", "NEW_SERVICE", "PERSONAL", "UPSKILLING"])
    .nullable(),
  courseId: id,
  priority: z.number().int().min(-100000).max(100000),
  active: z.boolean(),
});
export const adminSchema = z.object({
  telegramId: z.string().regex(/^[1-9]\d{0,15}$/),
  name: title,
  role: z.enum(["ADMIN", "MANAGER"]),
  language: z.enum(["RU", "KZ"]).default("RU"),
});
export const clientSchema = z.object({
  language: z.enum(["RU", "KZ"]).default("RU"),
  primaryGoal: primaryGoal.default(null),
  familyProblem: familyProblem.default(null),
  beautyProfession: beautyProfession.default(null),
  selectedTariffId: id.nullable().default(null),
  firstName: title,
  lastName: z.string().trim().max(120).nullable(),
  phone: z.string().trim().max(40).nullable(),
  experienceLevel: ruleSchema.shape.experienceLevel,
  categoryId: id.nullable(),
  learningGoal: ruleSchema.shape.learningGoal,
  selectedCourseId: id.nullable(),
  currentFunnelStage: z.enum([
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
});
export const configSchema = z.object({
  projectName: title,
  supportUsername: z.string().regex(/^$|^@?[A-Za-z][A-Za-z0-9_]{4,31}$/),
  adminNotifications: z.boolean(),
  remindersEnabled: z.boolean(),
  demoDelayHours: z.number().int().min(1).max(8760),
  paymentDelayHours: z.number().int().min(1).max(8760),
  funnelDelayHours: z.number().int().min(1).max(8760).default(3),
  reminderMaxAttempts: z.number().int().min(1).max(20).default(3),
  expertContact: z
    .string()
    .regex(/^$|^@?[A-Za-z][A-Za-z0-9_]{4,31}$/)
    .default(""),
  trialEnabled: z.boolean().default(false),
  trialDescriptionRU: z.string().max(1200).default(""),
  trialDescriptionKZ: z.string().max(1200).default(""),
  trialContactUsername: z
    .string()
    .regex(/^$|^@?[A-Za-z][A-Za-z0-9_]{4,31}$/)
    .default(""),
  trialBookingUrl: httpUrl.nullable().default(null),
  trialNotificationAdmins: z
    .string()
    .regex(/^$|^[1-9]\d{0,15}(,[1-9]\d{0,15})*$/)
    .default(""),
  inviteLifetimeHours: z.number().int().min(1).max(168),
});
export const defaultSettings = {
  projectName: "Course Sales Funnel",
  supportUsername: "",
  adminNotifications: true,
  remindersEnabled: false,
  demoDelayHours: 3,
  paymentDelayHours: 3,
  funnelDelayHours: 3,
  reminderMaxAttempts: 3,
  expertContact: "",
  trialEnabled: false,
  trialDescriptionRU: "",
  trialDescriptionKZ: "",
  trialContactUsername: "",
  trialBookingUrl: null,
  trialNotificationAdmins: "",
  inviteLifetimeHours: 24,
};
export const requisitesSchema = z
  .object({
    country: z.enum(["KZ", "RU"]),
    currency: z.enum(["KZT", "RUB"]),
    enabled: z.boolean(),
    title,
    instruction: z.string().trim().max(1200),
    requisites: z.string().trim().max(1200),
  })
  .refine(
    (x) => (x.country === "KZ") === (x.currency === "KZT"),
    "Country/currency mismatch",
  )
  .refine(
    (x) => !x.enabled || (!!x.instruction && !!x.requisites),
    t("error.requiredRequisites"),
  );

export const translationSchema = z.object({
  title: z
    .string()
    .trim()
    .max(120)
    .nullable()
    .transform((v) => v ?? ""),
  description: z.string().trim().max(1200).nullable().default(null),
  shortDescription: z.string().trim().max(300).nullable().default(null),
  fullDescription: z.string().trim().max(1200).nullable().default(null),
  program: z.string().trim().max(1200).nullable().default(null),
  duration: z.string().trim().max(120).nullable().default(null),
  buttonText: z.string().trim().max(120).nullable().default(null),
});
export const tariffSchema = z.object({
  courseId: id,
  code: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9_]{0,31}$/),
  title,
  titleKZ: z.string().trim().max(120).nullable().default(null),
  description: z.string().trim().max(1200).nullable().default(null),
  priceKZT: money,
  priceRUB: money,
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(100000).default(0),
});
export const funnelSchema = z.object({
  text: z
    .string()
    .trim()
    .max(3900)
    .nullable()
    .transform((v) => v ?? ""),
  active: z.boolean(),
});
export const bonusSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
  targetSegment: z.enum(["PROFESSIONAL", "FAMILY", "BEAUTY"]),
  type: z.enum(["VIDEO", "DOCUMENT", "CHECKLIST", "URL"]),
  active: z.boolean(),
  fileId: z.string().max(500).nullable().default(null),
  fileType: z.enum(["video", "document"]).nullable().default(null),
  url: httpUrl.nullable().default(null),
});
