import { z } from "zod";
export const title = z.string().trim().min(1).max(120);
const text = z.string().trim().min(1).max(1200);
const id = z.string().min(1).max(40);
const money = z.string().regex(/^\d{1,9}(\.\d{1,2})?$/);
const nullable = z.string().trim().max(500).nullable();
export const categorySchema = z.object({
  title,
  description: z.string().trim().max(1000).nullable().default(null),
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(100000),
});
export const courseSchema = z.object({
  title,
  shortDescription: z.string().trim().min(1).max(300),
  fullDescription: text,
  categoryId: id,
  program: text,
  duration: title,
  priceKZT: money,
  priceRUB: money,
  imageFileId: nullable.default(null),
  imageFileType: z.enum(["photo", "document"]).nullable().default(null),
  imageUrl: z.url().max(500).nullable().default(null),
  demoFileId: nullable.default(null),
  demoFileType: z.enum(["video", "document"]).nullable().default(null),
  demoVideoUrl: z.url().max(500).nullable().default(null),
  telegramChannelId: z
    .string()
    .regex(/^(?:-100\d{5,15}|@[A-Za-z][A-Za-z0-9_]{4,31})$/)
    .nullable(),
  status: z.enum(["DRAFT", "ACTIVE", "HIDDEN", "ARCHIVED"]),
  sortOrder: z.number().int().min(0).max(100000).default(0),
});
export const ruleSchema = z.object({
  experienceLevel: z
    .enum(["BEGINNER", "PRACTICING", "PROFESSIONAL", "UPSKILLING"])
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
});
export const clientSchema = z.object({
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
  inviteLifetimeHours: z.number().int().min(1).max(168),
});
export const defaultSettings = {
  projectName: "Course Sales Funnel",
  supportUsername: "",
  adminNotifications: true,
  remindersEnabled: false,
  demoDelayHours: 24,
  paymentDelayHours: 12,
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
    "Для включения заполните инструкцию и реквизиты",
  );
