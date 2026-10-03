import { Context, InlineKeyboard, Keyboard } from "grammy";
import { PrismaClient, User } from "@prisma/client";
import {
  courseKeyboard,
  experienceLabels,
  goalLabels,
  mainMenu,
} from "../keyboards/menu";
export async function showQuestion(ctx: Context, db: PrismaClient, user: User) {
  const keyboard = new InlineKeyboard();
  let text = "";
  if (user.conversationStep === "EXPERIENCE") {
    text = "Расскажите немного о вашем опыте.";
    Object.entries(experienceLabels).forEach(([value, label]) =>
      keyboard
        .text(label, `q:${user.questionnaireVersion}:experience:${value}`)
        .row(),
    );
  } else if (user.conversationStep === "CATEGORY") {
    text = "Какое направление вас интересует?";
    const categories = await db.courseCategory.findMany({
      where: { active: true },
      orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
    });
    categories.forEach((category) =>
      keyboard
        .text(
          category.title,
          `q:${user.questionnaireVersion}:category:${category.id}`,
        )
        .row(),
    );
    if (!categories.length)
      text = "Направления пока не добавлены. Напишите менеджеру.";
  } else if (user.conversationStep === "GOAL") {
    text = "Для чего вы хотите пройти обучение?";
    Object.entries(goalLabels).forEach(([value, label]) =>
      keyboard
        .text(label, `q:${user.questionnaireVersion}:goal:${value}`)
        .row(),
    );
  } else {
    await catalog(ctx, db, user, true);
    await ctx.reply("Можете поделиться номером для связи. Это необязательно.", {
      reply_markup: new Keyboard()
        .requestContact("Поделиться номером")
        .row()
        .text("Главное меню")
        .resized()
        .oneTime(),
    });
    return;
  }
  if (["CATEGORY", "GOAL"].includes(user.conversationStep))
    keyboard.text("Назад", `qback:${user.questionnaireVersion}`).row();
  keyboard.text("Главное меню", "menu").text("Задать вопрос", "manager");
  await ctx.reply(text, { reply_markup: keyboard });
}
export async function catalog(
  ctx: Context,
  db: PrismaClient,
  user: User,
  recommendations = false,
  page = 1,
) {
  const pageSize = 8;
  const courses = recommendations
    ? (
        await db.courseRecommendation.findMany({
          where: {
            userId: user.id,
            questionnaireVersion: user.questionnaireVersion,
            course: { status: "ACTIVE", category: { active: true } },
          },
          include: { course: true },
          orderBy: [{ score: "desc" }, { createdAt: "asc" }],
          take: 5,
        })
      ).map((item) => item.course)
    : await db.course.findMany({
        where: { status: "ACTIVE", category: { active: true } },
        orderBy: { title: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
  await ctx.reply(
    courses.length
      ? recommendations
        ? "По вашим ответам вам могут подойти следующие программы."
        : "Программы обучения:"
      : "Сейчас нет опубликованных программ. Напишите менеджеру.",
    { reply_markup: mainMenu() },
  );
  for (const course of courses) {
    if (course.imageUrl) await ctx.replyWithPhoto(course.imageUrl);
    await ctx.reply(
      `${course.title}\n\n${course.shortDescription}\nДлительность: ${course.duration}\nСтоимость: ${course.priceKZT} KZT / ${course.priceRUB} RUB`,
      { reply_markup: courseKeyboard(course.id) },
    );
  }
  if (!recommendations) {
    const total = await db.course.count({
      where: { status: "ACTIVE", category: { active: true } },
    });
    if (total > pageSize) {
      const navigation = new InlineKeyboard();
      if (page > 1) navigation.text("Назад", `catalog:${page - 1}`);
      if (page * pageSize < total)
        navigation.text("Далее", `catalog:${page + 1}`);
      navigation.row().text("Главное меню", "menu");
      await ctx.reply(`Страница ${page} из ${Math.ceil(total / pageSize)}`, {
        reply_markup: navigation,
      });
    }
  }
}
