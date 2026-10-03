import { Api, InlineKeyboard } from "grammy";
export type ButtonRows = {
  text: string;
  callback_data?: string;
  url?: string;
}[][];
export interface TelegramGateway {
  send(chatId: string, text: string, buttons?: ButtonRows): Promise<void>;
  receipt(
    chatId: string,
    fileId: string,
    fileType: string,
    caption: string,
    buttons: ButtonRows,
  ): Promise<void>;
  createInvite(
    channelId: string,
    name: string,
    expiresAt: Date,
  ): Promise<string>;
  revokeInvite(channelId: string, link: string): Promise<void>;
}
export class GrammyGateway implements TelegramGateway {
  constructor(public api: Api) {}
  async send(chatId: string, text: string, buttons?: ButtonRows) {
    await this.api.sendMessage(chatId, text, {
      ...(buttons
        ? { reply_markup: { inline_keyboard: buttons } as InlineKeyboard }
        : {}),
    });
  }
  async receipt(
    chatId: string,
    fileId: string,
    fileType: string,
    caption: string,
    buttons: ButtonRows,
  ) {
    const options = {
      caption,
      reply_markup: { inline_keyboard: buttons } as InlineKeyboard,
    };
    if (fileType === "photo") await this.api.sendPhoto(chatId, fileId, options);
    else await this.api.sendDocument(chatId, fileId, options);
  }
  async createInvite(channelId: string, name: string, expiresAt: Date) {
    const result = await this.api.createChatInviteLink(channelId, {
      name: name.slice(0, 32),
      member_limit: 1,
      expire_date: Math.floor(expiresAt.getTime() / 1000),
    });
    return result.invite_link;
  }
  async revokeInvite(channelId: string, link: string) {
    await this.api.revokeChatInviteLink(channelId, link);
  }
}
