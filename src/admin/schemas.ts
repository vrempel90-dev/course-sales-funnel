import { z } from "zod";
import {
  CourseStatus,
  ExperienceLevel,
  LearningGoal,
  Role,
  ManagerRequestStatus,
  FunnelStage,
} from "@prisma/client";
const text = z.string().trim();
const optionalText = text.max(3000).nullable().optional();
const url = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//.test(value), "Используйте HTTP(S) URL")
  .nullable()
  .optional();
export const categorySchema = z.object({
  title: text.min(1).max(100),
  slug: text.regex(/^[a-z0-9-]+$/).max(100),
  active: z.boolean(),
  sortOrder: z.number().int().min(0).max(10000),
});
export const courseSchema = z.object({
  title: text.min(1).max(180),
  slug: text.regex(/^[a-z0-9-]+$/).max(100),
  shortDescription: text.min(1).max(1000),
  fullDescription: text.min(1).max(3000),
  imageUrl: url,
  demoVideoUrl: url,
  demoFileId: text.max(512).nullable().optional(),
  program: text.min(1).max(3000),
  duration: text.min(1).max(100),
  categoryId: text.min(1),
  status: z.enum(CourseStatus),
  telegramChannelId: text
    .regex(/^-100\d+$/)
    .nullable()
    .optional(),
  priceKZT: z.coerce.number().positive().max(9999999999).multipleOf(0.01),
  priceRUB: z.coerce.number().positive().max(9999999999).multipleOf(0.01),
});
export const ruleSchema = z.object({
  experienceLevel: z.enum(ExperienceLevel).nullable(),
  learningGoal: z.enum(LearningGoal).nullable(),
  categoryId: text.nullable(),
  courseId: text.min(1),
  matchMode: z.enum(["ALL", "ANY"]),
  priority: z.number().int().min(-10000).max(10000),
  active: z.boolean(),
});
export const adminSchema = z
  .object({
    name: text.min(1).max(120),
    email: z
      .email()
      .transform((value) => value.toLowerCase())
      .nullable(),
    telegramId: text.regex(/^\d+$/).nullable(),
    password: z.string().min(12).max(200).optional(),
    role: z.enum(Role),
    active: z.boolean(),
  })
  .refine(
    (value) => value.email || value.telegramId,
    "Укажите email или Telegram ID",
  );
export const clientSchema = z.object({
  phone: optionalText,
  firstName: text.min(1).max(120).optional(),
  lastName: optionalText,
  currentFunnelStage: z.enum(FunnelStage).optional(),
});
export const requestSchema = z.object({
  status: z.enum(ManagerRequestStatus),
  assignedTo: text.nullable(),
  message: text.min(1).max(3000),
});
