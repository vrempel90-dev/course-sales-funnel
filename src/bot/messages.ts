import { Context, InlineKeyboard } from "grammy";
export async function display(
  ctx: Context,
  text: string,
  keyboard: InlineKeyboard,
) {
  const chunks: string[] = [];
  let rest = text;
  while (rest.length > 3900) {
    let end = 3900;
    if (/[\uD800-\uDBFF]/.test(rest[end - 1])) end--;
    chunks.push(rest.slice(0, end));
    rest = rest.slice(end);
  }
  chunks.push(rest);
  const options = { reply_markup: keyboard },
    body = chunks[0];
  if (ctx.callbackQuery?.message && "text" in ctx.callbackQuery.message) {
    try {
      await ctx.editMessageText(body, options);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("message is not modified")
      )
        return;
      if (
        error instanceof Error &&
        /message to edit not found|message can't be edited/.test(error.message)
      )
        await ctx.reply(body, options);
      else throw error;
    }
  } else if (ctx.callbackQuery?.message) {
    try {
      await ctx.editMessageCaption({
        caption: body.slice(0, 1000),
        ...options,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("message is not modified")
      )
        return;
      throw error;
    }
    if (body.length > 1000) await ctx.reply(body.slice(1000));
  } else await ctx.reply(body, options);
  for (const chunk of chunks.slice(1)) await ctx.reply(chunk);
}
