import { AdminUser, Language, PrismaClient } from "@prisma/client";
import { Context, InlineKeyboard } from "grammy";
import { AppError, recordError, safeError } from "../../lib/errors";
import { t, content } from "../../i18n";
import { Section, permitted, requireAdmin } from "../../services/auth";
import { AdminService, Entity } from "../../services/admin";
import type { TranslationKind } from "../../services/catalog";
import { Conversations, fields, payload } from "../../services/conversations";
import {
  AdminRepository,
  clientName,
  date,
  filters,
} from "../../repositories/admin";
import { back, button, home } from "../keyboards/admin";
import { display } from "../messages";
import { pagination } from "../../utils/pagination";
const editEntities: Partial<Record<Section, Entity>> = {
  categories: "category",
  courses: "course",
  tariffs: "tariff",
  funnel: "funnel",
  bonuses: "bonus",
  rules: "rule",
  clients: "client",
  requisites: "requisites",
  settings: "settings",
};
const dash = (v: unknown) =>
  v == null || v === "" ? "—" : v instanceof Date ? date(v) : String(v);
const stages = [
  "WELCOME",
  "PROFESSIONAL",
  "FAMILY",
  "BEAUTY",
  "SALE",
  "REMINDERS",
];
export class AdminViews {
  public repo: AdminRepository;
  constructor(
    public db: PrismaClient,
    public flows: Conversations,
    public username?: string,
  ) {
    this.repo = new AdminRepository(db);
  }
  async home(ctx: Context, admin: AdminUser) {
    await display(
      ctx,
      t("admin.title", admin.language) + "\n" + admin.name + " · " + admin.role,
      home(admin.role, admin.language),
    );
  }
  async menu(ctx: Context, admin: AdminUser, section: Section) {
    await requireAdmin(this.db, admin.id, section);
    const tr = (key: string) => t(key, admin.language),
      k = new InlineKeyboard();
    if (section === "stats")
      return display(
        ctx,
        await this.repo.stats(admin.language),
        back(k, "a:home", admin.language),
      );
    if (section === "status") return this.status(ctx, admin);
    if (section === "languages") {
      button(k, tr("filter.RU"), "a:lang:RU").row();
      button(k, tr("filter.KZ"), "a:lang:KZ");
    } else if (section === "requisites") {
      button(k, "🇰🇿 KZT", "a:card:requisites:KZ").row();
      button(k, "🇷🇺 RUB", "a:card:requisites:RU");
    } else if (section === "funnel") {
      for (const stage of stages)
        button(k, tr("funnel." + stage), "a:fstage:" + stage).row();
    } else if (section === "settings") {
      const data = await new AdminService(this.db).settings();
      for (const f of fields.settings)
        button(
          k,
          tr("common.edit") + " " + tr(f.label),
          "a:edit:settings:config:" + f.key,
        ).row();
      return display(
        ctx,
        tr("settings.title") +
          "\n" +
          fields.settings
            .map(
              (f) =>
                tr(f.label) + ": " + dash(data[f.key as keyof typeof data]),
            )
            .join("\n"),
        back(k, "a:home", admin.language),
      );
    } else {
      const kind =
        editEntities[section] ?? (section === "staff" ? "admin" : undefined);
      if (
        kind &&
        ["category", "course", "tariff", "rule", "admin"].includes(kind) &&
        permitted(admin.role, section, true)
      )
        button(k, tr("common.add"), "a:new:" + kind).row();
      for (const filter of filters[section] ?? []) {
        const label = tr("filter." + filter);
        button(
          k,
          label.startsWith("filter.") ? tr("value." + filter) : label,
          filter === "search"
            ? "a:new:search"
            : "a:list:" + section + ":" + filter + ":0",
        ).row();
      }
    }
    await display(
      ctx,
      tr(section + ".title"),
      back(k, "a:home", admin.language),
    );
  }
  async stage(ctx: Context, admin: AdminUser, stage: string) {
    await requireAdmin(this.db, admin.id, "funnel");
    if (!stages.includes(stage)) throw new AppError(t("error.unknownStage"));
    const k = new InlineKeyboard();
    for (const language of ["RU", "KZ"])
      button(
        k,
        language === "RU" ? "🇷🇺 RU" : "🇰🇿 KZ",
        "a:list:funnel:" + stage + "_" + language + ":0",
      ).row();
    await display(
      ctx,
      t("funnel." + stage, admin.language),
      back(k, "a:menu:funnel", admin.language),
    );
  }
  async list(
    ctx: Context,
    admin: AdminUser,
    section: Section,
    filter: string,
    page: number,
    userId?: string,
  ) {
    await requireAdmin(this.db, admin.id, section);
    let search: string | undefined;
    if (filter === "search") {
      const state = await this.flows.state(admin.id);
      if (state.flowType !== "search")
        throw new AppError(t("error.searchStale"));
      search = String(payload(state).data.query);
    }
    const tr = (key: string) => t(key, admin.language),
      data = await this.repo.list(
        section,
        filter,
        page,
        userId,
        search,
        admin.language,
      ),
      k = new InlineKeyboard();
    for (const row of data.rows)
      button(
        k,
        row.label.slice(0, 90),
        "a:card:" + section + ":" + row.id,
      ).row();
    const cb = (p: number) =>
      userId
        ? (section === "tariffs" ? "a:ctar:" : "a:related:" + section + ":") +
          userId +
          ":" +
          p
        : "a:list:" + section + ":" + filter + ":" + p;
    if (data.page > 0) button(k, "⬅️", cb(data.page - 1));
    if (data.page < data.pages - 1) button(k, "➡️", cb(data.page + 1));
    if (section === "tariffs" && userId && permitted(admin.role, section, true))
      button(k.row(), tr("common.add"), "a:tnew:" + userId).row();
    const target = userId
      ? "a:card:" +
        (section === "tariffs" ? "courses" : "clients") +
        ":" +
        userId
      : "a:menu:" + section;
    await display(
      ctx,
      tr(section + ".title") +
        "\n" +
        tr("common.page") +
        " " +
        (data.page + 1) +
        "/" +
        data.pages +
        " · " +
        tr("common.total") +
        " " +
        data.total +
        (data.rows.length
          ? "\n\n" + data.rows.map((r, i) => i + 1 + ". " + r.label).join("\n")
          : "\n\n" + tr("common.empty")),
      back(k, target, admin.language),
    );
  }
  edits(k: InlineKeyboard, admin: AdminUser, section: Section, id: string) {
    const kind = editEntities[section];
    if (!kind || !permitted(admin.role, section, true)) return;
    const excluded =
      kind === "course"
        ? [
            "title",
            "titleKZ",
            "shortDescription",
            "shortDescriptionKZ",
            "fullDescription",
            "fullDescriptionKZ",
            "program",
            "programKZ",
            "duration",
            "durationKZ",
          ]
        : kind === "category"
          ? ["title", "titleKZ", "description", "descriptionKZ"]
          : kind === "tariff"
            ? ["title", "titleKZ", "description", "courseId"]
            : [];
    for (const f of fields[kind].filter((f) => !excluded.includes(f.key)))
      button(
        k,
        t("common.edit", admin.language) +
          " " +
          t(f.label, admin.language).slice(0, 44),
        "a:edit:" + kind + ":" + id + ":" + f.key,
      ).row();
  }
  translationButtons(
    k: InlineKeyboard,
    admin: AdminUser,
    section: Section,
    kind: TranslationKind,
    id: string,
  ) {
    if (!permitted(admin.role, section, true)) return;
    for (const language of ["RU", "KZ"])
      button(
        k,
        t(language === "RU" ? "card.ru" : "card.kz", admin.language),
        "a:tr:" + kind + ":" + id + ":" + language,
      ).row();
  }
  async translation(
    ctx: Context,
    admin: AdminUser,
    kind: TranslationKind,
    id: string,
    language: Language,
  ) {
    const row = await new AdminService(this.db).translation(
        admin.id,
        kind,
        id,
        language,
      ),
      k = new InlineKeyboard();
    for (const f of fields[kind])
      button(
        k,
        t("common.edit", admin.language) + " " + t(f.label, admin.language),
        "a:edit:" + kind + ":" + row.id + ":" + f.key,
      ).row();
    const section =
      kind === "ct"
        ? "courses"
        : kind === "kt"
          ? "categories"
          : kind === "tt"
            ? "tariffs"
            : "bonuses";
    const data = row as unknown as Record<string, unknown>;
    await display(
      ctx,
      language +
        "\n" +
        fields[kind]
          .map((f) => t(f.label, admin.language) + ": " + dash(data[f.key]))
          .join("\n"),
      back(k, "a:card:" + section + ":" + id, admin.language),
    );
  }
  async card(ctx: Context, admin: AdminUser, section: Section, id: string) {
    await requireAdmin(this.db, admin.id, section);
    const tr = (key: string) => t(key, admin.language),
      k = new InlineKeyboard();
    const line = (key: string, value: unknown) =>
      tr("field." + key) + ": " + dash(value);
    const value = (v: unknown) => {
      const text = tr("value." + v);
      return text.startsWith("value.") ? dash(v) : text;
    };
    const warn = (rows: { language: Language; title: string }[]) =>
      rows.some((r) => r.language === "KZ" && r.title.trim())
        ? ""
        : "\n" + tr("common.warningKZ");
    let text: string;
    if (section === "clients") {
      const u = await this.db.user.findUniqueOrThrow({
        where: { id },
        include: {
          category: true,
          selectedCourse: { include: { translations: true } },
          selectedTariff: { include: { translations: true } },
        },
      });
      text =
        clientName(u) +
        "\n" +
        [
          line("telegramId", u.telegramId),
          line("username", u.telegramUsername),
          line("phone", u.phone),
          line("language", u.language),
          line("primaryGoal", value(u.primaryGoal)),
          line("experienceLevel", value(u.experienceLevel)),
          line("familyProblem", value(u.familyProblem)),
          line("beautyProfession", value(u.beautyProfession)),
          line("learningGoal", value(u.learningGoal)),
          line("categoryId", u.category?.title),
          line(
            "selectedCourseId",
            u.selectedCourse
              ? content(
                  u.selectedCourse.translations,
                  admin.language,
                  "title",
                ) || u.selectedCourse.title
              : null,
          ),
          line(
            "selectedTariffId",
            u.selectedTariff
              ? content(
                  u.selectedTariff.translations,
                  admin.language,
                  "title",
                ) || u.selectedTariff.code
              : null,
          ),
          line("currentFunnelStage", u.currentFunnelStage),
          line("createdAt", u.createdAt),
          line("updatedAt", u.updatedAt),
          line("lastActivityAt", u.lastActivityAt),
        ].join("\n");
      for (const s of [
        "payments",
        "courses",
        "access",
        "requests",
      ] as Section[])
        if (permitted(admin.role, s))
          button(k, tr(s + ".title"), "a:related:" + s + ":" + id + ":0").row();
      button(k, tr("card.history"), "a:history:" + id + ":0").row();
    } else if (section === "courses") {
      const c = await this.db.course.findUniqueOrThrow({
        where: { id },
        include: {
          category: { include: { translations: true } },
          translations: true,
          _count: { select: { tariffs: true } },
        },
      });
      text =
        (content(c.translations, admin.language, "title") || c.title) +
        warn(c.translations) +
        "\n" +
        [
          line(
            "categoryId",
            content(c.category.translations, admin.language, "title") ||
              c.category.title,
          ),
          line("status", value(c.status)),
          line("active", value(c.active)),
          line("tariffId", c._count.tariffs),
          line("telegramChannelId", c.telegramChannelId),
          line("cover", c.imageFileId || c.imageUrl),
          line("demo", c.demoFileId || c.demoVideoUrl),
          line("sortOrder", c.sortOrder),
        ].join("\n");
      for (const field of [
        "shortDescription",
        "fullDescription",
        "program",
        "duration",
      ] as const)
        text +=
          "\n" +
          line(
            field,
            content(c.translations, admin.language, field) || c[field],
          );
      this.translationButtons(k, admin, section, "ct", id);
      if (permitted(admin.role, "tariffs"))
        button(k, tr("tariffs.title"), "a:ctar:" + id + ":0").row();
      if (c.imageFileId || c.imageUrl)
        button(k, tr("card.showCover"), "a:media:cover:" + id).row();
      if (c.demoFileId || c.demoVideoUrl)
        button(k, tr("card.showDemo"), "a:media:demo:" + id).row();
    } else if (section === "categories") {
      const c = await this.db.courseCategory.findUniqueOrThrow({
        where: { id },
        include: { translations: true },
      });
      text =
        (content(c.translations, admin.language, "title") || c.title) +
        warn(c.translations) +
        "\n" +
        [
          line("code", c.code),
          line(
            "description",
            content(c.translations, admin.language, "description") ||
              c.description,
          ),
          line("active", value(c.active)),
          line("sortOrder", c.sortOrder),
        ].join("\n");
      this.translationButtons(k, admin, section, "kt", id);
    } else if (section === "tariffs") {
      const tariff = await this.db.courseTariff.findUniqueOrThrow({
        where: { id },
        include: { translations: true, course: true },
      });
      text =
        (content(tariff.translations, admin.language, "title") || tariff.code) +
        warn(tariff.translations) +
        "\n" +
        [
          line("courseId", tariff.course.title),
          line("code", tariff.code),
          line(
            "description",
            content(tariff.translations, admin.language, "description"),
          ),
          line("priceKZT", tariff.priceKZT),
          line("priceRUB", tariff.priceRUB),
          line("active", value(tariff.active)),
          line("sortOrder", tariff.sortOrder),
        ].join("\n");
      this.translationButtons(k, admin, section, "tt", id);
      if (permitted(admin.role, section, true))
        button(k, tr("common.delete"), "a:tdel:" + id).row();
    } else if (section === "funnel") {
      const f = await this.db.funnelContent.findUniqueOrThrow({
        where: { id },
      });
      const ru =
        f.language === "KZ" && !f.text
          ? await this.db.funnelContent.findUnique({
              where: { key_language: { key: f.key, language: "RU" } },
            })
          : null;
      text =
        f.key +
        " · " +
        f.language +
        "\n" +
        line("active", value(f.active)) +
        (f.language === "KZ" && !f.text ? "\n" + tr("common.warningKZ") : "") +
        "\n\n" +
        (f.text || ru?.text || "—");
    } else if (section === "bonuses") {
      const b = await this.db.bonusMaterial.findUniqueOrThrow({
        where: { id },
        include: { translations: true },
      });
      text =
        (content(b.translations, admin.language, "title") || b.code) +
        warn(b.translations) +
        "\n" +
        [
          line("code", b.code),
          line("targetSegment", value(b.targetSegment)),
          line("type", b.type),
          line("media", b.fileId || b.url),
          line("active", value(b.active)),
        ].join("\n");
      this.translationButtons(k, admin, section, "bt", id);
      if (b.fileId || b.url)
        button(k, tr("card.showBonus"), "a:bmedia:" + id).row();
    } else if (section === "rules") {
      const r = await this.db.recommendationRule.findUniqueOrThrow({
        where: { id },
        include: { course: true },
      });
      text =
        tr("rules.title") +
        "\n" +
        [
          "primaryGoal",
          "experienceLevel",
          "familyProblem",
          "beautyProfession",
          "categoryId",
          "learningGoal",
        ]
          .map((key) => line(key, value(r[key as keyof typeof r] ?? "ANY")))
          .join(" AND\n") +
        "\n→ " +
        r.course.title +
        "\n" +
        line("priority", r.priority) +
        "\n" +
        line("active", value(r.active));
      if (permitted(admin.role, section, true))
        button(k, tr("common.delete"), "a:delete:" + id).row();
    } else if (section === "payments") {
      const p = await this.db.payment.findUniqueOrThrow({
        where: { id },
        include: {
          user: true,
          course: true,
          tariff: { include: { translations: true } },
        },
      });
      text =
        tr("payments.title") +
        "\n" +
        clientName(p.user) +
        "\n" +
        [
          line("courseId", p.course.title),
          line(
            "tariffId",
            p.tariff
              ? content(p.tariff.translations, admin.language, "title") ||
                  p.tariff.code
              : null,
          ),
          line("amount", p.amount),
          line("currency", p.currency),
          line("country", p.country),
          line("paymentMethod", p.paymentMethod),
          line("status", value(p.status)),
          line("createdAt", p.createdAt),
          line("reviewedAt", p.reviewedAt),
          line("rejectionReason", p.rejectionReason),
        ].join("\n");
      if (p.receiptFileId)
        button(k, tr("card.receipt"), "a:receipt:" + id).row();
      if (
        p.status === "PENDING_REVIEW" &&
        permitted(admin.role, section, true)
      ) {
        button(k, tr("card.approve"), "a:approve:" + id).row();
        button(k, tr("card.reject"), "a:reject:" + id).row();
      }
      button(k, tr("card.client"), "a:card:clients:" + p.userId).row();
    } else if (section === "access") {
      const e = await this.db.enrollment.findUniqueOrThrow({
        where: { id },
        include: {
          user: true,
          course: true,
          tariff: { include: { translations: true } },
        },
      });
      text =
        tr("access.title") +
        "\n" +
        clientName(e.user) +
        "\n" +
        [
          line("courseId", e.course.title),
          line(
            "tariffId",
            e.tariff
              ? content(e.tariff.translations, admin.language, "title") ||
                  e.tariff.code
              : null,
          ),
          line("status", value(e.status)),
          line("accessStatus", value(e.accessStatus)),
          line("telegramInviteLink", e.telegramInviteLink),
          line("inviteExpiresAt", e.inviteExpiresAt),
          line("accessGrantedAt", e.accessGrantedAt),
          line("accessError", e.accessError),
        ].join("\n");
      if (permitted(admin.role, section, true)) {
        button(k, tr("card.retry"), "a:retry:" + id).row();
        if (
          ["CREATING", "UNCERTAIN"].includes(e.accessStatus) ||
          e.accessError?.startsWith("UNCERTAIN:")
        )
          button(k, tr("card.reconcile"), "a:reconcile:" + id).row();
      }
      button(k, tr("card.client"), "a:card:clients:" + e.userId).row();
    } else if (section === "requests") {
      const r = await this.db.managerRequest.findUniqueOrThrow({
        where: { id },
        include: { user: true, course: true, assignee: true },
      });
      text =
        tr("requests.title") +
        "\n" +
        clientName(r.user) +
        "\n" +
        [
          line("courseId", r.course?.title),
          line("message", r.message),
          line("status", value(r.status)),
          line("assignee", r.assignee?.name),
          line("createdAt", r.createdAt),
        ].join("\n");
      if (permitted(admin.role, section, true) && r.status !== "RESOLVED") {
        button(k, tr("card.claim"), "a:request:" + id + ":IN_PROGRESS").row();
        button(k, tr("card.resolve"), "a:request:" + id + ":RESOLVED").row();
      }
      button(k, tr("card.client"), "a:card:clients:" + r.userId).row();
    } else if (section === "staff") {
      const a = await this.db.adminUser.findUniqueOrThrow({ where: { id } });
      text =
        a.name +
        "\n" +
        [
          line("telegramId", a.telegramId),
          line("username", a.username),
          line("role", a.role),
          line("language", a.language),
          line("active", value(a.active)),
          line("createdAt", a.createdAt),
          line("lastActivityAt", a.lastActivityAt),
        ].join("\n");
      for (const role of ["OWNER", "ADMIN", "MANAGER"])
        button(
          k,
          tr("field.role") + " → " + role,
          "a:staffconfirm:" + id + ":role:" + role,
        ).row();
      button(
        k,
        tr(a.active ? "common.disabled" : "common.enabled"),
        "a:staffconfirm:" + id + ":active:" + !a.active,
      );
    } else if (section === "requisites") {
      if (!["KZ", "RU"].includes(id))
        throw new AppError(t("error.unknownCountry"));
      const r = await this.db.paymentMethodSetting.findUniqueOrThrow({
        where: { country: id as "KZ" | "RU" },
      });
      text =
        r.country +
        " / " +
        r.currency +
        "\n" +
        [
          line("title", r.title),
          line("enabled", value(r.enabled)),
          line("instruction", r.instruction),
          line("requisites", r.requisites),
        ].join("\n");
    } else throw new AppError(t("error.cardUnavailable"));
    this.edits(k, admin, section, id);
    await display(ctx, text, back(k, "a:menu:" + section, admin.language));
  }
  async history(ctx: Context, admin: AdminUser, id: string, page: number) {
    await requireAdmin(this.db, admin.id, "clients");
    const p = pagination(
        await this.db.funnelEvent.count({ where: { userId: id } }),
        page,
      ),
      rows = await this.db.funnelEvent.findMany({
        where: { userId: id },
        skip: p.skip,
        take: p.take,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: { course: true },
      }),
      k = new InlineKeyboard();
    if (p.page > 0) button(k, "⬅️", "a:history:" + id + ":" + (p.page - 1));
    if (p.page < p.pages - 1)
      button(k, "➡️", "a:history:" + id + ":" + (p.page + 1));
    await display(
      ctx,
      t("card.history", admin.language) +
        " · " +
        (p.page + 1) +
        "/" +
        p.pages +
        "\n\n" +
        (rows
          .map(
            (r) =>
              date(r.createdAt) +
              " · " +
              r.type +
              " · " +
              dash(r.course?.title) +
              "\n" +
              JSON.stringify(r.metadata),
          )
          .join("\n\n") || t("common.empty", admin.language)),
      back(k, "a:card:clients:" + id, admin.language),
    );
  }
  async status(ctx: Context, admin: AdminUser) {
    await requireAdmin(this.db, admin.id, "status");
    const tr = (key: string) => t(key, admin.language);
    let connected = true,
      telegram = true,
      username = this.username;
    try {
      await this.db.$queryRaw`SELECT 1`;
    } catch {
      connected = false;
    }
    try {
      username = (await ctx.api.getMe()).username;
    } catch (error) {
      telegram = false;
      await recordError(this.db, error, { section: "status" });
    }
    const [admins, courses, error] = connected
      ? await Promise.all([
          this.db.adminUser.count({ where: { active: true } }),
          this.db.course.count({ where: { active: true, status: "ACTIVE" } }),
          this.db.telegramBotError.findFirst({
            orderBy: { createdAt: "desc" },
          }),
        ])
      : [0, 0, null];
    await display(
      ctx,
      tr("status.title") +
        "\n" +
        tr("status.database") +
        ": " +
        (connected ? "✅" : "❌") +
        "\n" +
        tr("status.telegram") +
        ": " +
        (telegram ? "✅" : "❌") +
        "\nUsername: " +
        dash(username) +
        "\nUptime: " +
        Math.floor(process.uptime()) +
        " s\n" +
        tr("status.admins") +
        ": " +
        admins +
        "\n" +
        tr("status.courses") +
        ": " +
        courses +
        "\n" +
        tr("status.environment") +
        ": " +
        dash(process.env.NODE_ENV) +
        "\n" +
        tr("status.error") +
        ": " +
        (error ? safeError(error.message) : "—"),
      back(new InlineKeyboard(), "a:home", admin.language),
    );
  }
}
