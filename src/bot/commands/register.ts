import { Bot, Context, InlineKeyboard } from "grammy";
import { PrismaClient } from "@prisma/client";
import { WorkflowService } from "../../services/workflow";
import { mainMenu } from "../keyboards/menu";
import { showQuestion } from "../conversations/questionnaire";
export function registerCommands(
  bot: Bot<Context>,
  db: PrismaClient,
  workflow: WorkflowService,
) {
  bot.command("start", async (ctx) => {
    if (!ctx.from || ctx.chat.type !== "private") return;
    const user = await workflow.user(ctx.from);
    await workflow.start(user.id);
    await ctx.reply(
      "Здравствуйте! Я помогу подобрать подходящую программу обучения.\nОтветьте на несколько вопросов, и я покажу подходящие варианты.",
      {
        reply_markup: new InlineKeyboard()
          .text("Начать подбор", "questionnaire")
          .row()
          .text("Главное меню", "menu"),
      },
    );
    if (["EXPERIENCE", "CATEGORY", "GOAL"].includes(user.conversationStep))
      await showQuestion(ctx, db, user);
    if (user.conversationStep === "RECEIPT")
      await ctx.reply(
        "Продолжим: отправьте чек фотографией или PDF/document.",
        { reply_markup: mainMenu() },
      );
    if (user.conversationStep === "COUNTRY" && user.selectedCourseId)
      await ctx.reply("Продолжим: где вы будете оплачивать?", {
        reply_markup: new InlineKeyboard()
          .text("🇰🇿 Казахстан", `country:KZ:${user.selectedCourseId}`)
          .text("🇷🇺 Россия", `country:RU:${user.selectedCourseId}`)
          .row()
          .text("Главное меню", "menu"),
      });
  });
  bot.command("menu", (ctx) =>
    ctx.reply("Главное меню", { reply_markup: mainMenu() }),
  );
  bot.command("id", (ctx) =>
    ctx.reply(
      `Ваш Telegram ID: ${ctx.from?.id ?? "—"}\nChat ID: ${ctx.chat.id}`,
    ),
  );
}
