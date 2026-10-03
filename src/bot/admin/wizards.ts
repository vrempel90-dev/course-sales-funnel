import {
  AdminUser,
  AdminConversationState,
  PrismaClient,
} from "@prisma/client";
import { Context, InlineKeyboard } from "grammy";
import { AppError } from "../../lib/errors";
import {
  Conversations,
  fieldFor,
  fields,
  payload,
} from "../../services/conversations";
import { button } from "../keyboards/admin";
import { display } from "../messages";
import { pagination } from "../../utils/pagination";
export const labels: Record<string, string> = {
  true: "Да",
  false: "Нет",
  ANY: "Любое",
  BEGINNER: "Новичок",
  PRACTICING: "Практикующий",
  PROFESSIONAL: "Профессионал",
  UPSKILLING: "Повышение квалификации",
  NEW_PROFESSION: "Новая профессия",
  NEW_SERVICE: "Новая услуга",
  PERSONAL: "Для себя",
  DRAFT: "Черновик",
  ACTIVE: "Активен",
  HIDDEN: "Скрыт",
  ARCHIVED: "Архив",
  ADMIN: "Администратор",
  MANAGER: "Менеджер",
};
export class WizardView {
  constructor(
    public db: PrismaClient,
    public flows: Conversations,
  ) {}
  async show(ctx: Context, state: AdminConversationState, page = 0) {
    const p = payload(state),
      field = fieldFor(state),
      k = new InlineKeyboard();
    const cb = (action: string, value: string) =>
      "w:" + state.nonce + ":" + action + ":" + value;
    if (!field) {
      const names: Record<string, string> = {};
      if (typeof p.data.categoryId === "string")
        names.categoryId =
          (
            await this.db.courseCategory.findUnique({
              where: { id: p.data.categoryId },
            })
          )?.title ?? "Удалённое направление";
      for (const key of ["courseId", "selectedCourseId"])
        if (typeof p.data[key] === "string")
          names[key] =
            (
              await this.db.course.findUnique({
                where: { id: p.data[key] as string },
              })
            )?.title ?? "Удалённый курс";
      const summary = Object.entries(p.data)
        .filter(
          ([key]) =>
            fields[state.flowType as keyof typeof fields].some(
              (x) => x.key === key,
            ) ||
            ["imageFileId", "imageUrl", "demoFileId", "demoVideoUrl"].includes(
              key,
            ),
        )
        .map(
          ([key, value]) =>
            (fields[state.flowType as keyof typeof fields].find(
              (x) => x.key === key,
            )?.label ?? key) +
            ": " +
            (value == null
              ? "—"
              : (names[key] ?? labels[String(value)] ?? String(value))),
        )
        .join("\n");
      button(k, p.id ? "✅ Сохранить" : "✅ Создать", cb("save", "ok")).row();
      for (const key of p.keys)
        button(
          k,
          "✏️ " +
            fields[state.flowType as keyof typeof fields]
              .find((x) => x.key === key)!
              .label.slice(0, 45),
          cb("edit", key),
        ).row();
      button(k, "❌ Отмена", cb("cancel", "ok"));
      await display(ctx, "Предпросмотр\n\n" + summary, k);
      return;
    }
    if (field.type === "bool" || field.type === "choice") {
      const options =
        field.type === "bool" ? ["true", "false"] : (field.options ?? []);
      for (const value of options)
        button(k, labels[value] ?? value, cb("pick", value)).row();
    }
    if (field.type === "category" || field.type === "course") {
      const total =
        field.type === "category"
          ? await this.db.courseCategory.count()
          : await this.db.course.count();
      const p = pagination(total, page);
      const records =
        field.type === "category"
          ? await this.db.courseCategory.findMany({
              skip: p.skip,
              take: p.take,
              orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
            })
          : await this.db.course.findMany({
              skip: p.skip,
              take: p.take,
              orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
            });
      for (const record of records)
        button(k, record.title, cb("pick", record.id)).row();
      if (p.page > 0) button(k, "⬅️", cb("page", String(p.page - 1)));
      if (p.page < p.pages - 1) button(k, "➡️", cb("page", String(p.page + 1)));
      k.row();
    }
    if (field.nullable)
      button(k, "Любое / пропустить", cb("pick", "ANY")).row();
    if (field.type === "cover" || field.type === "demo")
      button(k, "Пропустить", cb("pick", "-")).row();
    button(k, "❌ Отмена", cb("cancel", "ok"));
    const current = p.data[field.key];
    await display(
      ctx,
      "Шаг " +
        (state.step + 1) +
        "/" +
        p.keys.length +
        "\n" +
        field.label +
        (current != null
          ? "\nТекущее значение: " + String(current).slice(0, 1200)
          : "") +
        "\n\n/cancel — отменить",
      k,
    );
  }
  async message(ctx: Context, admin: AdminUser) {
    const raw = await this.db.adminConversationState.findUnique({
      where: { adminId: admin.id },
    });
    if (!raw) return false;
    const state = await this.flows.state(admin.id);
    if (payload(state).lastUpdateId === ctx.update.update_id) {
      if (state.flowType === "search") return state;
      await this.show(ctx, state);
      return true;
    }
    const field = fieldFor(state);
    if (!field) return false;
    let value: unknown = ctx.message?.text;
    if (field.type === "cover" || field.type === "demo") {
      const msg = ctx.message!;
      const url = msg.text?.trim();
      let fileId: string | null = null;
      if (field.type === "cover") {
        if (msg.photo?.length) fileId = msg.photo.at(-1)!.file_id;
        else if (msg.document?.mime_type?.startsWith("image/"))
          fileId = msg.document.file_id;
      } else {
        if (msg.video) fileId = msg.video.file_id;
        else if (msg.document?.mime_type?.startsWith("video/"))
          fileId = msg.document.file_id;
      }
      if (url && url !== "-") {
        try {
          const parsed = new URL(url);
          if (!["https:", "http:"].includes(parsed.protocol)) throw new Error();
        } catch {
          throw new AppError("Пришлите корректный HTTP(S) URL или файл");
        }
      }
      if (!fileId && !url)
        throw new AppError(
          "Неподдерживаемый файл. Пришлите фото/видео или документ соответствующего типа.",
        );
      value =
        field.type === "cover"
          ? {
              imageFileId: fileId,
              imageFileType: fileId
                ? msg.document
                  ? "document"
                  : "photo"
                : null,
              imageUrl: url && url !== "-" ? url : null,
            }
          : {
              demoFileId: fileId,
              demoFileType: fileId
                ? msg.document
                  ? "document"
                  : "video"
                : null,
              demoVideoUrl: url && url !== "-" ? url : null,
            };
    }
    const next = await this.flows.input(
      admin.id,
      state.nonce,
      value,
      ctx.update.update_id,
    );
    if (state.flowType === "search") return next;
    await this.show(ctx, next);
    return true;
  }
  async pick(ctx: Context, admin: AdminUser, nonce: string, value: string) {
    const state = await this.flows.state(admin.id, nonce),
      field = fieldFor(state);
    if (!field) throw new AppError("Кнопка устарела");
    if (["text", "money", "number"].includes(field.type) && !field.nullable)
      throw new AppError("Введите значение сообщением");
    const media =
      field.type === "cover"
        ? { imageFileId: null, imageFileType: null, imageUrl: null }
        : { demoFileId: null, demoFileType: null, demoVideoUrl: null };
    if (["cover", "demo"].includes(field.type) && value !== "-")
      throw new AppError("Пришлите файл или URL");
    await this.show(
      ctx,
      await this.flows.input(
        admin.id,
        nonce,
        ["cover", "demo"].includes(field.type) ? media : value,
      ),
    );
  }
}
