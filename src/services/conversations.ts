import { t } from "../i18n";
import { randomBytes, createHash } from "node:crypto";
import { AdminConversationState, Prisma, PrismaClient } from "@prisma/client";
import { AppError } from "../lib/errors";
import { AdminService, Entity, entitySection } from "./admin";
import { PaymentService } from "./payments";
import { requireAdmin } from "./auth";
import { atomic } from "./transaction";
import { configSchema, defaultSettings } from "./schemas";
import { fields } from "./admin-fields";
export { fields } from "./admin-fields";
export type FlowData = {
  data: Record<string, unknown>;
  id?: string;
  keys: string[];
  previewEdit?: boolean;
  lastUpdateId?: number;
  revision?: string;
};
export function payload(state: AdminConversationState): FlowData {
  return state.payload as unknown as FlowData;
}
export function fieldFor(state: AdminConversationState) {
  const p = payload(state);
  return fields[state.flowType as keyof typeof fields]?.find(
    (x) => x.key === p.keys[state.step],
  );
}
const json = (value: unknown) =>
  JSON.parse(
    JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  ) as Prisma.InputJsonValue;
const nonce = () => randomBytes(6).toString("hex");
async function readFormData(
  db: PrismaClient | Prisma.TransactionClient,
  kind: keyof typeof fields,
  id: string,
) {
  let value: unknown;
  switch (kind) {
    case "course":
      value = await db.course.findUniqueOrThrow({ where: { id } });
      break;
    case "tariff": {
      const tariff = await db.courseTariff.findUniqueOrThrow({
        where: { id },
        include: { translations: true },
      });
      const ru = tariff.translations.find((t) => t.language === "RU");
      const kz = tariff.translations.find((t) => t.language === "KZ");
      value = {
        ...tariff,
        title: ru?.title ?? tariff.code,
        description: ru?.description ?? null,
        titleKZ: kz?.title || null,
      };
      break;
    }
    case "ct":
      value = await db.courseTranslation.findUniqueOrThrow({ where: { id } });
      break;
    case "kt":
      value = await db.courseCategoryTranslation.findUniqueOrThrow({
        where: { id },
      });
      break;
    case "tt":
      value = await db.courseTariffTranslation.findUniqueOrThrow({
        where: { id },
      });
      break;
    case "bt":
      value = await db.bonusMaterialTranslation.findUniqueOrThrow({
        where: { id },
      });
      break;
    case "funnel":
      value = await db.funnelContent.findUniqueOrThrow({ where: { id } });
      break;
    case "bonus":
      value = await db.bonusMaterial.findUniqueOrThrow({ where: { id } });
      break;
    case "category":
      value = await db.courseCategory.findUniqueOrThrow({
        where: { id },
      });
      break;
    case "rule":
      value = await db.recommendationRule.findUniqueOrThrow({
        where: { id },
      });
      break;
    case "client":
      value = await db.user.findUniqueOrThrow({ where: { id } });
      break;
    case "settings":
      value = configSchema.parse(
        (await db.setting.findUnique({ where: { key: "admin.settings" } }))
          ?.value ?? defaultSettings,
      );
      break;
    case "requisites":
      value = await db.paymentMethodSetting.findUniqueOrThrow({
        where: { country: id as "KZ" | "RU" },
      });
      break;
    case "reject":
      await db.payment.findUniqueOrThrow({ where: { id } });
      value = {};
      break;
    default:
      throw new AppError(t("error.invalidWizard"));
  }
  return value;
}
const revision = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(json(value)))
    .digest("hex");
export class Conversations {
  constructor(public db: PrismaClient) {}
  async state(adminId: string, expected?: string) {
    const state = await this.db.adminConversationState.findUnique({
      where: { adminId },
    });
    if (!state) throw new AppError(t("error.noWizard"));
    if (state.expiresAt < new Date()) {
      await this.db.adminConversationState.deleteMany({
        where: { adminId, nonce: state.nonce },
      });
      throw new AppError(t("error.wizardExpired"));
    }
    if (expected && state.nonce !== expected)
      throw new AppError(t("error.staleButton"));
    const section =
      state.flowType === "search"
        ? "clients"
        : state.flowType === "reject"
          ? "payments"
          : entitySection[state.flowType as Entity];
    if (!section) throw new AppError(t("error.unknownWizard"));
    await requireAdmin(this.db, adminId, section, state.flowType !== "search");
    return state;
  }
  async begin(
    adminId: string,
    kind: keyof typeof fields,
    id?: string,
    key?: string,
    initial: Record<string, unknown> = {},
  ) {
    const section =
      kind === "search"
        ? "clients"
        : kind === "reject"
          ? "payments"
          : entitySection[kind];
    await requireAdmin(this.db, adminId, section, kind !== "search");
    let data: Record<string, unknown> = {
      sortOrder: 0,
      active: true,
      language: "RU",
      ...initial,
      imageFileId: null,
      imageUrl: null,
      demoFileId: null,
      demoVideoUrl: null,
    };
    if (id) {
      data = json(await readFormData(this.db, kind, id)) as Record<
        string,
        unknown
      >;
    }
    const keys = key
      ? [key]
      : fields[kind]
          .filter(
            (x) =>
              (kind !== "course" || !["sortOrder", "active"].includes(x.key)) &&
              !(kind === "tariff" && initial.courseId && x.key === "courseId"),
          )
          .map((x) => x.key);
    if (keys.some((k) => !fields[kind].some((f) => f.key === k)))
      throw new AppError(t("error.invalidField"));
    return this.db.adminConversationState.upsert({
      where: { adminId },
      update: {
        flowType: kind,
        step: 0,
        nonce: nonce(),
        payload: json({
          data,
          id,
          keys,
          revision: id && kind !== "reject" ? revision(data) : undefined,
        }),
        expiresAt: new Date(Date.now() + 3600000),
      },
      create: {
        adminId,
        flowType: kind,
        step: 0,
        nonce: nonce(),
        payload: json({
          data,
          id,
          keys,
          revision: id && kind !== "reject" ? revision(data) : undefined,
        }),
        expiresAt: new Date(Date.now() + 3600000),
      },
    });
  }
  async input(
    adminId: string,
    expected: string,
    value: unknown,
    updateId?: number,
  ) {
    const state = await this.state(adminId, expected);
    const field = fieldFor(state);
    if (!field) throw new AppError(t("error.confirmWizard"));
    let parsed: unknown = value;
    if (field.nullable && (value === "ANY" || value === "-")) parsed = null;
    else if (field.type === "bool") {
      if (!["true", "false"].includes(String(value)))
        throw new AppError(t("error.chooseButton"));
      parsed = value === "true";
    } else if (field.type === "choice") {
      if (!field.options?.includes(String(value)))
        throw new AppError(t("error.chooseValue"));
    } else if (field.type === "number") {
      if (!/^-?\d{1,6}$/.test(String(value)))
        throw new AppError(t("error.integer"));
      parsed = Number(value);
    } else if (field.type === "money") {
      const amount = String(value).trim().replace(",", ".");
      if (!/^\d{1,9}(\.\d{1,2})?$/.test(amount))
        throw new AppError(t("error.money"));
      parsed = amount;
    } else if (
      field.type === "category" ||
      field.type === "course" ||
      field.type === "tariff"
    ) {
      if (typeof value !== "string" || !/^[a-z0-9-]{1,40}$/.test(value))
        throw new AppError(t("error.chooseRecord"));
      if (field.type === "category")
        await this.db.courseCategory.findUniqueOrThrow({
          where: { id: value },
        });
      else if (field.type === "course")
        await this.db.course.findUniqueOrThrow({ where: { id: value } });
      else
        await this.db.courseTariff.findUniqueOrThrow({ where: { id: value } });
    } else if (
      field.type === "cover" ||
      field.type === "demo" ||
      field.type === "media"
    ) {
      if (typeof value !== "object" || !value)
        throw new AppError(t("error.file"));
    } else {
      if (typeof value !== "string") throw new AppError(t("error.text"));
      parsed = value.trim();
      if (
        String(parsed).length > (field.max ?? 120) ||
        (!parsed &&
          ![
            "supportUsername",
            "expertContact",
            "trialDescriptionRU",
            "trialDescriptionKZ",
            "trialContactUsername",
            "trialNotificationAdmins",
          ].includes(field.key))
      )
        throw new AppError(t("error.textLength") + (field.max ?? 120) + ")");
      if (
        [
          "supportUsername",
          "expertContact",
          "trialDescriptionRU",
          "trialDescriptionKZ",
          "trialContactUsername",
          "trialNotificationAdmins",
        ].includes(field.key) &&
        parsed === "-"
      )
        parsed = "";
    }
    const p = payload(state);
    if (
      field.type === "cover" ||
      field.type === "demo" ||
      field.type === "media"
    )
      Object.assign(p.data, parsed);
    else p.data[field.key] = parsed;
    const step = p.previewEdit ? p.keys.length : state.step + 1;
    p.previewEdit = false;
    if (updateId !== undefined) p.lastUpdateId = updateId;
    return atomic(this.db, async (tx) => {
      await requireAdmin(
        tx,
        adminId,
        state.flowType === "search"
          ? "clients"
          : state.flowType === "reject"
            ? "payments"
            : entitySection[state.flowType as Entity],
        state.flowType !== "search",
      );
      if (
        !(
          await tx.adminConversationState.updateMany({
            where: { adminId, nonce: expected },
            data: {
              step,
              payload: json(p),
              nonce: nonce(),
              expiresAt: new Date(Date.now() + 3600000),
            },
          })
        ).count
      )
        throw new AppError(t("error.stale"));
      return tx.adminConversationState.findUniqueOrThrow({
        where: { adminId },
      });
    });
  }
  async editPreview(adminId: string, expected: string, key: string) {
    const state = await this.state(adminId, expected),
      p = payload(state);
    if (state.step !== p.keys.length || !p.keys.includes(key))
      throw new AppError(t("error.editDenied"));
    const updated = await this.db.adminConversationState.updateMany({
      where: { adminId, nonce: expected },
      data: {
        step: p.keys.indexOf(key),
        nonce: nonce(),
        payload: json({ ...p, previewEdit: true }),
      },
    });
    if (!updated.count) throw new AppError(t("error.stale"));
    return this.state(adminId);
  }
  async commit(adminId: string, expected: string) {
    const state = await this.state(adminId, expected),
      p = payload(state);
    if (state.step !== p.keys.length || state.flowType === "search")
      throw new AppError(t("error.wizardIncomplete"));
    if (state.flowType === "reject")
      return new PaymentService(this.db).review(
        adminId,
        p.id!,
        false,
        String(p.data.reason),
        expected,
      );
    return atomic(this.db, async (tx) => {
      const current = await tx.adminConversationState.findUnique({
        where: { adminId },
      });
      if (
        !current ||
        current.nonce !== expected ||
        current.expiresAt < new Date()
      )
        throw new AppError(t("error.wizardComplete"));
      if (
        p.id &&
        p.revision &&
        revision(
          await readFormData(tx, state.flowType as keyof typeof fields, p.id),
        ) !== p.revision
      )
        throw new AppError(t("error.changed"));
      const result = await new AdminService(this.db).saveTx(
        tx,
        adminId,
        state.flowType as Entity,
        p.data,
        p.id,
      );
      await tx.adminConversationState.delete({ where: { adminId } });
      return result;
    });
  }
  async cancel(adminId: string) {
    await this.db.adminConversationState.deleteMany({ where: { adminId } });
  }
}
