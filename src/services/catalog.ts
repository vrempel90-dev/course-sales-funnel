import { t } from "../i18n";
import { Prisma, Language } from "@prisma/client";
import { AppError } from "../lib/errors";
import {
  categorySchema,
  courseSchema,
  tariffSchema,
  translationSchema,
  funnelSchema,
  bonusSchema,
} from "./schemas";

export type TranslationKind = "ct" | "kt" | "tt" | "bt";
export async function saveCategory(
  tx: Prisma.TransactionClient,
  input: unknown,
  slug: string,
  id?: string,
) {
  const { titleKZ, descriptionKZ, ...data } = categorySchema.parse(input);
  const c = id
    ? await tx.courseCategory.update({ where: { id }, data })
    : await tx.courseCategory.create({ data: { ...data, slug, code: slug } });
  for (const language of ["RU", "KZ"] as const) {
    const title = language === "RU" ? data.title : (titleKZ ?? "");
    const description = language === "RU" ? data.description : descriptionKZ;
    await tx.courseCategoryTranslation.upsert({
      where: { categoryId_language: { categoryId: c.id, language } },
      create: { categoryId: c.id, language, title, description },
      update:
        language === "RU" || titleKZ !== null ? { title, description } : {},
    });
  }
  return c;
}
export async function saveCourse(
  tx: Prisma.TransactionClient,
  input: unknown,
  slug: string,
  id?: string,
) {
  const {
    titleKZ,
    shortDescriptionKZ,
    fullDescriptionKZ,
    programKZ,
    durationKZ,
    ...data
  } = courseSchema.parse(input);
  const c = id
    ? await tx.course.update({ where: { id }, data })
    : await tx.course.create({ data: { ...data, slug } });
  for (const language of ["RU", "KZ"] as const) {
    const text =
      language === "RU"
        ? {
            title: data.title,
            shortDescription: data.shortDescription,
            fullDescription: data.fullDescription,
            program: data.program,
            duration: data.duration,
          }
        : {
            title: titleKZ ?? "",
            shortDescription: shortDescriptionKZ,
            fullDescription: fullDescriptionKZ,
            program: programKZ,
            duration: durationKZ,
          };
    await tx.courseTranslation.upsert({
      where: { courseId_language: { courseId: c.id, language } },
      create: { courseId: c.id, language, ...text },
      update: language === "RU" || titleKZ !== null ? text : {},
    });
  }
  return c;
}
export async function saveTariff(
  tx: Prisma.TransactionClient,
  input: unknown,
  id?: string,
) {
  const { title, titleKZ, description, ...data } = tariffSchema.parse(input);
  if (id) {
    const old = await tx.courseTariff.findUniqueOrThrow({ where: { id } });
    if (old.courseId !== data.courseId)
      throw new AppError(t("error.tariffMove"));
  }
  const tariff = id
    ? await tx.courseTariff.update({ where: { id }, data })
    : await tx.courseTariff.create({ data });
  for (const language of ["RU", "KZ"] as const)
    await tx.courseTariffTranslation.upsert({
      where: { tariffId_language: { tariffId: tariff.id, language } },
      create: {
        tariffId: tariff.id,
        language,
        title: language === "RU" ? title : (titleKZ ?? ""),
        description: language === "RU" ? description : null,
      },
      update:
        language === "RU"
          ? { title, description }
          : titleKZ !== null
            ? { title: titleKZ }
            : {},
    });
  return tariff;
}
export async function saveTranslation(
  tx: Prisma.TransactionClient,
  kind: TranslationKind,
  input: unknown,
  id: string,
) {
  const parsed = translationSchema.parse(input);
  const data = { title: parsed.title, description: parsed.description };
  const courseData = {
    title: parsed.title,
    shortDescription: parsed.shortDescription,
    fullDescription: parsed.fullDescription,
    program: parsed.program,
    duration: parsed.duration,
  };
  const row =
    kind === "ct"
      ? await tx.courseTranslation.update({ where: { id }, data: courseData })
      : kind === "kt"
        ? await tx.courseCategoryTranslation.update({ where: { id }, data })
        : kind === "tt"
          ? await tx.courseTariffTranslation.update({ where: { id }, data })
          : await tx.bonusMaterialTranslation.update({
              where: { id },
              data: { ...data, buttonText: parsed.buttonText },
            });
  if (row.language === "RU" && !row.title)
    throw new AppError(t("error.requiredRU"));
  // Keep existing RU fields synchronized for integrations and legacy records.
  if (kind === "ct" && "courseId" in row && row.language === "RU")
    await tx.course.update({
      where: { id: row.courseId },
      data: {
        title: row.title,
        shortDescription: parsed.shortDescription ?? "",
        fullDescription: parsed.fullDescription ?? "",
        program: parsed.program ?? "",
        duration: parsed.duration ?? "",
      },
    });
  if (kind === "kt" && "categoryId" in row && row.language === "RU")
    await tx.courseCategory.update({ where: { id: row.categoryId }, data });
  return row;
}
export async function saveFunnel(
  tx: Prisma.TransactionClient,
  input: unknown,
  id: string,
) {
  const data = funnelSchema.parse(input);
  if (data.active && !data.text) throw new AppError(t("error.requiredText"));
  return tx.funnelContent.update({ where: { id }, data });
}
export async function saveBonus(
  tx: Prisma.TransactionClient,
  input: unknown,
  id: string,
) {
  const data = bonusSchema.parse(input);
  if (
    data.fileId &&
    ((data.type === "VIDEO" &&
      !["video", "document"].includes(data.fileType ?? "")) ||
      (["DOCUMENT", "CHECKLIST"].includes(data.type) &&
        data.fileType !== "document"))
  )
    throw new AppError(t("error.bonusType"));
  if (data.type === "URL" && data.fileId)
    throw new AppError(t("error.bonusURL"));
  return tx.bonusMaterial.update({ where: { id }, data });
}
export async function ensureTranslation(
  tx: Prisma.TransactionClient,
  kind: TranslationKind,
  parentId: string,
  language: Language,
) {
  if (kind === "ct") {
    const c = await tx.course.findUniqueOrThrow({ where: { id: parentId } });
    return tx.courseTranslation.upsert({
      where: { courseId_language: { courseId: parentId, language } },
      update: {},
      create: {
        courseId: parentId,
        language,
        title: language === "RU" ? c.title : "",
        shortDescription: language === "RU" ? c.shortDescription : null,
        fullDescription: language === "RU" ? c.fullDescription : null,
        program: language === "RU" ? c.program : null,
        duration: language === "RU" ? c.duration : null,
      },
    });
  }
  if (kind === "kt") {
    const c = await tx.courseCategory.findUniqueOrThrow({
      where: { id: parentId },
    });
    return tx.courseCategoryTranslation.upsert({
      where: { categoryId_language: { categoryId: parentId, language } },
      update: {},
      create: {
        categoryId: parentId,
        language,
        title: language === "RU" ? c.title : "",
        description: language === "RU" ? c.description : null,
      },
    });
  }
  if (kind === "tt")
    return tx.courseTariffTranslation.upsert({
      where: { tariffId_language: { tariffId: parentId, language } },
      update: {},
      create: { tariffId: parentId, language, title: "" },
    });
  return tx.bonusMaterialTranslation.upsert({
    where: { bonusId_language: { bonusId: parentId, language } },
    update: {},
    create: { bonusId: parentId, language, title: "" },
  });
}
