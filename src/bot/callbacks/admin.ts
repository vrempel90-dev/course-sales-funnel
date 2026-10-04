import { AdminUser, PrismaClient } from "@prisma/client";
import { Context, InlineKeyboard } from "grammy";
import { t } from "../../i18n";
import type { TranslationKind } from "../../services/catalog";
import { AppError } from "../../lib/errors";
import { Section, requireAdmin } from "../../services/auth";
import { AdminService, Entity } from "../../services/admin";
import { PaymentService } from "../../services/payments";
import { AccessService } from "../../services/access";
import { Conversations, fields } from "../../services/conversations";
import { GrammyGateway } from "../gateway";
import { AdminViews } from "../admin/views";
import { WizardView } from "../admin/wizards";
import { back, button, sections } from "../keyboards/admin";
import { display } from "../messages";
import { pageIndex } from "../../utils/pagination";
function section(value: string): Section {
  if (!Object.hasOwn(sections, value))
    throw new AppError(t("error.unknownSection"));
  return value as Section;
}
export async function callback(
  ctx: Context,
  admin: AdminUser,
  db: PrismaClient,
  views: AdminViews,
  wizard: WizardView,
  flows: Conversations,
) {
  const tr = (key: string) => t(key, admin.language);
  const localizedBack = (k = new InlineKeyboard(), target = "a:home") =>
    back(k, target, admin.language);
  const data = ctx.callbackQuery?.data;
  if (!data || Buffer.byteLength(data) > 64)
    throw new AppError(t("error.invalidButton"));
  const [prefix, action, ...args] = data.split(":");
  if (prefix === "w") {
    const nonce = action,
      [op, value] = args;
    const state = await flows.state(admin.id, nonce);
    if (op === "cancel") {
      await flows.cancel(admin.id);
      await views.home(ctx, admin);
    } else if (op === "pick") await wizard.pick(ctx, admin, nonce, value);
    else if (op === "page") await wizard.show(ctx, state, pageIndex(value));
    else if (op === "edit")
      await wizard.show(ctx, await flows.editPreview(admin.id, nonce, value));
    else if (op === "save") {
      await flows.commit(admin.id, nonce);
      await display(ctx, tr("common.saved"), localizedBack());
    } else throw new AppError(t("error.invalidButton"));
    return;
  }
  if (prefix !== "a") throw new AppError(t("error.invalidButton"));
  const service = new AdminService(db);
  switch (action) {
    case "lang":
      if (!["RU", "KZ"].includes(args[0]))
        throw new AppError(t("error.unknownLanguage"));
      await views.home(
        ctx,
        await service.language(admin.id, args[0] as "RU" | "KZ"),
      );
      break;
    case "fstage":
      await views.stage(ctx, admin, args[0]);
      break;
    case "ctar":
      await views.list(
        ctx,
        admin,
        "tariffs",
        "all",
        pageIndex(args[1]),
        args[0],
      );
      break;
    case "tnew":
      await requireAdmin(db, admin.id, "tariffs", true);
      await db.course.findUniqueOrThrow({ where: { id: args[0] } });
      await wizard.show(
        ctx,
        await flows.begin(admin.id, "tariff", undefined, undefined, {
          courseId: args[0],
        }),
      );
      break;
    case "tr":
      if (
        !["ct", "kt", "tt", "bt"].includes(args[0]) ||
        !["RU", "KZ"].includes(args[2])
      )
        throw new AppError(t("error.unknownTranslation"));
      await views.translation(
        ctx,
        admin,
        args[0] as TranslationKind,
        args[1],
        args[2] as "RU" | "KZ",
      );
      break;
    case "tdel":
      await requireAdmin(db, admin.id, "tariffs", true);
      await display(
        ctx,
        tr("common.deleteConfirm"),
        localizedBack(
          button(
            new InlineKeyboard(),
            tr("common.delete"),
            "a:tdelyes:" + args[0],
          ),
          "a:card:tariffs:" + args[0],
        ),
      );
      break;
    case "tdelyes": {
      const tariff = await service.deleteTariff(admin.id, args[0]);
      await views.list(ctx, admin, "tariffs", "all", 0, tariff.courseId);
      break;
    }
    case "bmedia": {
      await requireAdmin(db, admin.id, "bonuses");
      const bonus = await db.bonusMaterial.findUniqueOrThrow({
        where: { id: args[0] },
      });
      if (bonus.fileId && bonus.fileType === "video")
        await ctx.replyWithVideo(bonus.fileId);
      else if (bonus.fileId) await ctx.replyWithDocument(bonus.fileId);
      else if (bonus.url) await ctx.reply(bonus.url);
      else throw new AppError(tr("media.missing"));
      break;
    }
    case "home":
      await flows.cancel(admin.id);
      await views.home(ctx, admin);
      break;
    case "close":
      await flows.cancel(admin.id);
      await display(ctx, tr("common.closed"), new InlineKeyboard());
      break;
    case "menu":
      await flows.cancel(admin.id);
      await views.menu(ctx, admin, section(args[0]));
      break;
    case "list":
      await views.list(
        ctx,
        admin,
        section(args[0]),
        args[1],
        pageIndex(args[2]),
      );
      break;
    case "card":
      await views.card(ctx, admin, section(args[0]), args[1]);
      break;
    case "related":
      await requireAdmin(db, admin.id, "clients");
      await views.list(
        ctx,
        admin,
        section(args[0]),
        "all",
        pageIndex(args[2]),
        args[1],
      );
      break;
    case "history":
      await views.history(ctx, admin, args[0], pageIndex(args[1]));
      break;
    case "status":
      await views.status(ctx, admin);
      break;
    case "new":
    case "edit": {
      const kind = args[0];
      if (!Object.hasOwn(fields, kind))
        throw new AppError(t("error.unknownWizard"));
      if (action === "edit" && (!args[1] || !args[2]))
        throw new AppError(t("error.unknownField"));
      if (
        action === "new" &&
        !["course", "category", "tariff", "rule", "admin", "search"].includes(
          kind,
        )
      )
        throw new AppError(t("error.createDenied"));
      await wizard.show(
        ctx,
        await flows.begin(
          admin.id,
          kind as Entity | "search",
          action === "edit" ? args[1] : undefined,
          args[2],
        ),
      );
      break;
    }
    case "approve":
      await new PaymentService(db).review(admin.id, args[0], true);
      await views.card(ctx, admin, "payments", args[0]);
      break;
    case "reject": {
      await requireAdmin(db, admin.id, "payments", true);
      const k = new InlineKeyboard();
      for (const [key, label] of [
        ["unreadable", tr("reject.unreadable")],
        ["amount", tr("reject.amount")],
        ["missing", tr("reject.missing")],
        ["other", tr("reject.other")],
      ])
        button(k, label, "a:reason:" + args[0] + ":" + key).row();
      await display(
        ctx,
        tr("reject.prompt"),
        localizedBack(k, "a:card:payments:" + args[0]),
      );
      break;
    }
    case "reason": {
      const reasons: Record<string, string> = {
        unreadable: tr("reject.unreadable"),
        amount: tr("reject.amount"),
        missing: tr("reject.missing"),
      };
      if (args[1] === "other")
        await wizard.show(ctx, await flows.begin(admin.id, "reject", args[0]));
      else {
        if (!reasons[args[1]]) throw new AppError(t("error.unknownReason"));
        await new PaymentService(db).review(
          admin.id,
          args[0],
          false,
          reasons[args[1]],
        );
        await views.card(ctx, admin, "payments", args[0]);
      }
      break;
    }
    case "receipt": {
      await requireAdmin(db, admin.id, "payments");
      const p = await db.payment.findUniqueOrThrow({ where: { id: args[0] } });
      if (!p.receiptFileId) throw new AppError(t("error.noReceipt"));
      if (p.receiptType === "photo")
        await ctx.replyWithPhoto(p.receiptFileId, {
          caption: tr("payments.title") + " " + p.id,
        });
      else
        await ctx.replyWithDocument(p.receiptFileId, {
          caption: tr("payments.title") + " " + p.id,
        });
      break;
    }
    case "media": {
      await requireAdmin(db, admin.id, "courses");
      const c = await db.course.findUniqueOrThrow({ where: { id: args[1] } });
      if (
        args[0] === "cover" &&
        c.imageFileId &&
        c.imageFileType === "document"
      )
        await ctx.replyWithDocument(c.imageFileId);
      else if (args[0] === "cover" && (c.imageFileId || c.imageUrl))
        await ctx.replyWithPhoto(c.imageFileId || c.imageUrl!);
      else if (
        args[0] === "demo" &&
        c.demoFileId &&
        c.demoFileType === "document"
      )
        await ctx.replyWithDocument(c.demoFileId);
      else if (args[0] === "demo" && c.demoFileId)
        await ctx.replyWithVideo(c.demoFileId);
      else if (args[0] === "demo" && c.demoVideoUrl)
        await ctx.reply(tr("field.demo") + ": " + c.demoVideoUrl);
      else throw new AppError(tr("media.missing"));
      break;
    }
    case "retry":
      await new AccessService(db, new GrammyGateway(ctx.api)).retry(
        args[0],
        admin.id,
      );
      await views.card(ctx, admin, "access", args[0]);
      break;
    case "reconcile":
      await requireAdmin(db, admin.id, "access", true);
      await display(
        ctx,
        tr("access.check"),
        localizedBack(
          button(
            new InlineKeyboard(),
            tr("access.checked"),
            "a:retrychecked:" + args[0],
          ),
          "a:card:access:" + args[0],
        ),
      );
      break;
    case "retrychecked":
      await new AccessService(db, new GrammyGateway(ctx.api)).retry(
        args[0],
        admin.id,
        true,
      );
      await views.card(ctx, admin, "access", args[0]);
      break;
    case "request":
      if (!["IN_PROGRESS", "RESOLVED"].includes(args[1]))
        throw new AppError(t("error.invalidStatus"));
      await service.request(
        admin.id,
        args[0],
        args[1] as "IN_PROGRESS" | "RESOLVED",
      );
      await views.card(ctx, admin, "requests", args[0]);
      break;
    case "staffconfirm": {
      await requireAdmin(db, admin.id, "staff", true);
      const target = await db.adminUser.findUniqueOrThrow({
        where: { id: args[0] },
      });
      await display(
        ctx,
        target.name +
          "\n" +
          tr("common.confirm") +
          " " +
          args[1] +
          " → " +
          args[2],
        localizedBack(
          button(
            new InlineKeyboard(),
            tr("card.approve"),
            "a:staffapply:" + args.join(":"),
          ),
          "a:card:staff:" + args[0],
        ),
      );
      break;
    }
    case "staffapply": {
      if (args[1] === "role" && ["OWNER", "ADMIN", "MANAGER"].includes(args[2]))
        await service.changeStaff(admin.id, args[0], {
          role: args[2] as "OWNER" | "ADMIN" | "MANAGER",
        });
      else if (args[1] === "active" && ["true", "false"].includes(args[2]))
        await service.changeStaff(admin.id, args[0], {
          active: args[2] === "true",
        });
      else throw new AppError(t("error.invalidChange"));
      const actor = await db.adminUser.findUniqueOrThrow({
        where: { id: admin.id },
      });
      if (actor.active && actor.role === "OWNER")
        await views.card(ctx, actor, "staff", args[0]);
      else
        await display(
          ctx,
          tr("common.saved") + " /admin",
          new InlineKeyboard(),
        );
      break;
    }
    case "delete":
      await requireAdmin(db, admin.id, "rules", true);
      await display(
        ctx,
        tr("common.deleteConfirm"),
        localizedBack(
          button(
            new InlineKeyboard(),
            tr("common.delete"),
            "a:deleteyes:" + args[0],
          ),
          "a:card:rules:" + args[0],
        ),
      );
      break;
    case "deleteyes":
      await service.deleteRule(admin.id, args[0]);
      await views.menu(ctx, admin, "rules");
      break;
    default:
      throw new AppError(t("error.invalidButton"));
  }
}
