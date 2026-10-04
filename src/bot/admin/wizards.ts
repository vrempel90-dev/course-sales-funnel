import {
  AdminUser,
  AdminConversationState,
  PrismaClient,
} from "@prisma/client";
import { Context, InlineKeyboard } from "grammy";
import { t, content } from "../../i18n";
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
export class WizardView {
  constructor(
    public db: PrismaClient,
    public flows: Conversations,
  ) {}
  async show(ctx: Context, state: AdminConversationState, page = 0) {
    const admin = await this.db.adminUser.findUniqueOrThrow({
      where: { id: state.adminId },
    });
    const tr = (key: string) => t(key, admin.language);
    const label = (value: unknown) =>
      tr("value." + String(value)).startsWith("value.")
        ? String(value)
        : tr("value." + String(value));
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
          )?.title ?? t("categories.title", admin.language);
      for (const key of ["courseId", "selectedCourseId"])
        if (typeof p.data[key] === "string")
          names[key] =
            (
              await this.db.course.findUnique({
                where: { id: p.data[key] as string },
              })
            )?.title ?? t("courses.title", admin.language);
      const summary = Object.entries(p.data)
        .filter(
          ([key]) =>
            fields[state.flowType as keyof typeof fields].some(
              (x) => x.key === key,
            ) ||
            [
              "imageFileId",
              "imageUrl",
              "demoFileId",
              "demoVideoUrl",
              "fileId",
              "url",
            ].includes(key),
        )
        .map(
          ([key, value]) =>
            tr(
              fields[state.flowType as keyof typeof fields].find(
                (x) => x.key === key,
              )?.label ??
                (key.startsWith("image")
                  ? "field.cover"
                  : key.startsWith("demo")
                    ? "field.demo"
                    : ["fileId", "url"].includes(key)
                      ? "field.media"
                      : key),
            ) +
            ": " +
            (value == null ? "—" : (names[key] ?? label(value))),
        )
        .join("\n");
      button(
        k,
        p.id ? tr("common.save") : tr("common.create"),
        cb("save", "ok"),
      ).row();
      for (const key of p.keys)
        button(
          k,
          tr("common.edit") +
            " " +
            tr(
              fields[state.flowType as keyof typeof fields].find(
                (x) => x.key === key,
              )!.label,
            ).slice(0, 45),
          cb("edit", key),
        ).row();
      button(k, tr("common.cancel"), cb("cancel", "ok"));
      await display(ctx, tr("common.preview") + "\n\n" + summary, k);
      return;
    }
    if (field.type === "bool" || field.type === "choice") {
      const options =
        field.type === "bool" ? ["true", "false"] : (field.options ?? []);
      for (const value of options)
        button(k, label(value), cb("pick", value)).row();
    }
    if (["category", "course", "tariff"].includes(field.type)) {
      const where =
        field.type === "tariff" && typeof p.data.selectedCourseId === "string"
          ? { courseId: p.data.selectedCourseId }
          : {};
      const total =
        field.type === "category"
          ? await this.db.courseCategory.count()
          : field.type === "course"
            ? await this.db.course.count()
            : await this.db.courseTariff.count({ where });
      const pag = pagination(total, page);
      const query = {
        skip: pag.skip,
        take: pag.take,
        orderBy: [{ sortOrder: "asc" as const }, { id: "asc" as const }],
        include: { translations: true },
      };
      const records =
        field.type === "category"
          ? await this.db.courseCategory.findMany(query)
          : field.type === "course"
            ? await this.db.course.findMany(query)
            : await this.db.courseTariff.findMany({ ...query, where });
      for (const record of records)
        button(
          k,
          content<{ language: typeof admin.language; title: string }>(
            record.translations,
            admin.language,
            "title",
          ) || ("title" in record ? record.title : record.code),
          cb("pick", record.id),
        ).row();
      if (pag.page > 0) button(k, "⬅️", cb("page", String(pag.page - 1)));
      if (pag.page < pag.pages - 1)
        button(k, "➡️", cb("page", String(pag.page + 1)));
      k.row();
    }
    if (field.nullable) button(k, tr("common.skip"), cb("pick", "ANY")).row();
    if (
      field.type === "cover" ||
      field.type === "demo" ||
      field.type === "media"
    )
      button(k, tr("common.skip"), cb("pick", "-")).row();
    button(k, tr("common.cancel"), cb("cancel", "ok"));
    const current = p.data[field.key];
    await display(
      ctx,
      tr("common.step") +
        " " +
        (state.step + 1) +
        "/" +
        p.keys.length +
        "\n" +
        tr(field.label) +
        (current != null
          ? "\n" + tr("common.current") + ": " + String(current).slice(0, 1200)
          : "") +
        "\n\n" +
        tr("common.cancelHelp"),
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
    if (
      field.type === "cover" ||
      field.type === "demo" ||
      field.type === "media"
    ) {
      const msg = ctx.message!;
      const url = msg.text?.trim();
      let fileId: string | null = null;
      if (field.type === "cover") {
        if (msg.photo?.length) fileId = msg.photo.at(-1)!.file_id;
        else if (msg.document?.mime_type?.startsWith("image/"))
          fileId = msg.document.file_id;
      } else {
        if (msg.video) fileId = msg.video.file_id;
        else if (
          msg.document &&
          (msg.document.mime_type?.startsWith("video/") ||
            (field.type === "media" && payload(state).data.type !== "VIDEO"))
        )
          fileId = msg.document.file_id;
      }
      if (url && url !== "-") {
        try {
          const parsed = new URL(url);
          if (!["https:", "http:"].includes(parsed.protocol)) throw new Error();
        } catch {
          throw new AppError(t("media.url", admin.language));
        }
      }
      if (!fileId && !url)
        throw new AppError(t("media.invalid", admin.language));
      value =
        field.type === "media"
          ? {
              fileId,
              fileType: fileId ? (msg.document ? "document" : "video") : null,
              url: url && url !== "-" ? url : null,
            }
          : field.type === "cover"
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
    if (!field) throw new AppError(t("error.stale"));
    if (["text", "money", "number"].includes(field.type) && !field.nullable)
      throw new AppError(t("error.messageValue"));
    const media =
      field.type === "media"
        ? { fileId: null, fileType: null, url: null }
        : field.type === "cover"
          ? { imageFileId: null, imageFileType: null, imageUrl: null }
          : { demoFileId: null, demoFileType: null, demoVideoUrl: null };
    if (["cover", "demo", "media"].includes(field.type) && value !== "-")
      throw new AppError(t("error.file"));
    await this.show(
      ctx,
      await this.flows.input(
        admin.id,
        nonce,
        ["cover", "demo", "media"].includes(field.type) ? media : value,
      ),
    );
  }
}
