import { Context, InlineKeyboard } from "grammy";
export async function replyLong(
  ctx: Context,
  text: string,
  keyboard?: InlineKeyboard,
) {
  const characters = Array.from(text);
  for (let offset = 0; offset < characters.length; offset += 3900) {
    await ctx.reply(
      characters.slice(offset, offset + 3900).join(""),
      offset + 3900 >= characters.length && keyboard
        ? { reply_markup: keyboard }
        : {},
    );
  }
}
