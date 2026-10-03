import { AdminUser, PrismaClient } from "@prisma/client";
import { Context, InlineKeyboard } from "grammy";
import { AppError } from "../../lib/errors";
import { Section, permitted, requireAdmin } from "../../services/auth";
import { AdminService, Entity } from "../../services/admin";
import { Conversations, fields, payload } from "../../services/conversations";
import {
  AdminRepository,
  clientName,
  date,
  filters,
} from "../../repositories/admin";
import { back, button, home, pager, sections } from "../keyboards/admin";
import { display } from "../messages";
import { pagination } from "../../utils/pagination";
const filterLabels: Record<string, string> = {
  new: "Новые клиенты",
  waiting: "Ожидают оплаты",
  paid: "Оплатившие",
  attention: "Требуют внимания",
  all: "Все",
  search: "🔎 Поиск",
  ACTIVE: "Активные",
  HIDDEN: "Скрытые",
  ARCHIVED: "Архив",
  PENDING_REVIEW: "На проверке",
  PAID: "Подтверждённые",
  REJECTED: "Отклонённые",
  FAILED: "Ошибки доступа",
  PENDING: "Ожидают выдачи",
  GRANTED: "Выданные",
  NEW: "Новые",
  IN_PROGRESS: "В работе",
  RESOLVED: "Закрытые",
  active: "Активные",
  disabled: "Отключённые",
};
const editEntities: Partial<Record<Section, Entity>> = {
  categories: "category",
  courses: "course",
  rules: "rule",
  clients: "client",
  requisites: "requisites",
  settings: "settings",
};
const dash = (v: unknown) => (v == null || v === "" ? "—" : String(v));
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
      "⚙️ Админ-панель\n" + admin.name + " · " + admin.role,
      home(admin.role),
    );
  }
  async menu(ctx: Context, admin: AdminUser, section: Section) {
    await requireAdmin(this.db, admin.id, section);
    const k = new InlineKeyboard();
    if (section === "stats") {
      await display(ctx, await this.repo.stats(), back(k));
      return;
    }
    if (section === "requisites") {
      button(k, "🇰🇿 Казахстан · KZT", "a:card:requisites:KZ").row();
      button(k, "🇷🇺 Россия · RUB", "a:card:requisites:RU");
    } else if (section === "settings") {
      const data = await new AdminService(this.db).settings();
      for (const f of fields.settings)
        button(k, "✏️ " + f.label, "a:edit:settings:config:" + f.key).row();
      button(k, "🤖 Технический статус", "a:status");
      await display(
        ctx,
        "⚙️ Настройки\n" +
          fields.settings
            .map((f) => f.label + ": " + dash(data[f.key as keyof typeof data]))
            .join("\n"),
        back(k),
      );
      return;
    } else {
      const kind =
        editEntities[section] ?? (section === "staff" ? "admin" : undefined);
      if (kind && kind !== "client" && permitted(admin.role, section, true))
        button(k, "➕ Добавить", "a:new:" + kind).row();
      for (const filter of filters[section] ?? [])
        button(
          k,
          filterLabels[filter] ?? filter,
          filter === "search"
            ? "a:new:search"
            : "a:list:" + section + ":" + filter + ":0",
        ).row();
    }
    await display(ctx, sections[section], back(k));
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
      if (state.flowType !== "search") throw new AppError("Поиск устарел");
      search = String(payload(state).data.query);
    }
    const data = await this.repo.list(section, filter, page, userId, search);
    const k = new InlineKeyboard();
    for (const row of data.rows)
      button(
        k,
        row.label.slice(0, 90),
        "a:card:" + section + ":" + row.id,
      ).row();
    const cb = (p: number) =>
      userId
        ? "a:related:" + section + ":" + userId + ":" + p
        : "a:list:" + section + ":" + filter + ":" + p;
    pager(k, data.page, data.pages, cb);
    await display(
      ctx,
      sections[section] +
        " · " +
        (filterLabels[filter] ?? filter) +
        "\nСтраница " +
        (data.page + 1) +
        "/" +
        data.pages +
        " · всего " +
        data.total +
        (data.rows.length
          ? "\n\n" + data.rows.map((r, i) => i + 1 + ". " + r.label).join("\n")
          : "\n\nЗаписей нет."),
      back(k, userId ? "a:card:clients:" + userId : "a:menu:" + section),
    );
  }
  edits(k: InlineKeyboard, admin: AdminUser, section: Section, id: string) {
    const kind = editEntities[section];
    if (!kind || !permitted(admin.role, section, true)) return;
    for (const f of fields[kind])
      button(
        k,
        "✏️ " + f.label.slice(0, 44),
        "a:edit:" + kind + ":" + id + ":" + f.key,
      ).row();
  }
  async card(ctx: Context, admin: AdminUser, section: Section, id: string) {
    await requireAdmin(this.db, admin.id, section);
    const k = new InlineKeyboard();
    let text: string;
    if (section === "clients") {
      const u = await this.db.user.findUniqueOrThrow({
        where: { id },
        include: { category: true, selectedCourse: true },
      });
      text =
        "👤 " +
        clientName(u) +
        "\nTelegram ID: " +
        u.telegramId +
        "\nUsername: " +
        dash(u.telegramUsername) +
        "\nТелефон: " +
        dash(u.phone) +
        "\nОпыт: " +
        dash(u.experienceLevel) +
        "\nНаправление: " +
        dash(u.category?.title) +
        "\nЦель: " +
        dash(u.learningGoal) +
        "\nКурс: " +
        dash(u.selectedCourse?.title) +
        "\nЭтап: " +
        u.currentFunnelStage +
        "\nСоздан: " +
        date(u.createdAt) +
        "\nОбновлён: " +
        date(u.updatedAt) +
        "\nАктивность: " +
        date(u.lastActivityAt);
      for (const s of [
        "payments",
        "courses",
        "access",
        "requests",
      ] as Section[])
        if (permitted(admin.role, s))
          button(k, sections[s], "a:related:" + s + ":" + id + ":0").row();
      button(k, "🕘 История", "a:history:" + id + ":0").row();
      this.edits(k, admin, section, id);
    } else if (section === "courses") {
      const c = await this.db.course.findUniqueOrThrow({
        where: { id },
        include: { category: true },
      });
      text =
        "📚 " +
        c.title +
        "\n" +
        c.status +
        "\nНаправление: " +
        c.category.title +
        "\n" +
        c.shortDescription +
        "\n\n" +
        c.fullDescription +
        "\n\nПрограмма:\n" +
        c.program +
        "\nПродолжительность: " +
        c.duration +
        "\nЦена: " +
        c.priceKZT +
        " KZT / " +
        c.priceRUB +
        " RUB\nОбложка: " +
        dash(c.imageFileId ?? c.imageUrl) +
        "\nДемо: " +
        dash(c.demoFileId ?? c.demoVideoUrl) +
        "\nChannel ID: " +
        dash(c.telegramChannelId) +
        "\nПорядок: " +
        c.sortOrder;
      if (c.imageFileId || c.imageUrl)
        button(k, "🖼 Показать обложку", "a:media:cover:" + id).row();
      if (c.demoFileId || c.demoVideoUrl)
        button(k, "▶️ Показать демоурок", "a:media:demo:" + id).row();
      this.edits(k, admin, section, id);
    } else if (section === "categories") {
      const c = await this.db.courseCategory.findUniqueOrThrow({
        where: { id },
      });
      text =
        "🗂 " +
        c.title +
        "\nОписание: " +
        dash(c.description) +
        "\nАктивность: " +
        c.active +
        "\nПорядок: " +
        c.sortOrder;
      this.edits(k, admin, section, id);
    } else if (section === "rules") {
      const r = await this.db.recommendationRule.findUniqueOrThrow({
        where: { id },
        include: { category: true, course: true },
      });
      text =
        "🎯 Если опыт: " +
        (r.experienceLevel ?? "ANY") +
        " AND направление: " +
        (r.category?.title ?? "ANY") +
        " AND цель: " +
        (r.learningGoal ?? "ANY") +
        " → " +
        r.course.title +
        "\nПриоритет: " +
        r.priority +
        "\nАктивность: " +
        r.active;
      this.edits(k, admin, section, id);
      if (permitted(admin.role, section, true))
        button(k, "🗑 Удалить правило", "a:delete:" + id).row();
    } else if (section === "payments") {
      const p = await this.db.payment.findUniqueOrThrow({
        where: { id },
        include: { user: true, course: true },
      });
      text =
        "💳 Оплата\n" +
        clientName(p.user) +
        "\nКурс: " +
        p.course.title +
        "\nСумма: " +
        p.amount +
        " " +
        p.currency +
        "\nСтрана: " +
        p.country +
        "\nМетод: " +
        p.paymentMethod +
        "\nСтатус: " +
        p.status +
        "\nСоздана: " +
        date(p.createdAt) +
        "\nПроверена: " +
        (p.reviewedAt ? date(p.reviewedAt) : "—") +
        "\nПричина отклонения: " +
        dash(p.rejectionReason);
      if (p.receiptFileId)
        button(k, "📎 Показать чек", "a:receipt:" + id).row();
      if (
        p.status === "PENDING_REVIEW" &&
        permitted(admin.role, section, true)
      ) {
        button(k, "✅ Подтвердить", "a:approve:" + id).row();
        button(k, "❌ Отклонить", "a:reject:" + id).row();
      }
      button(k, "👤 Клиент", "a:card:clients:" + p.userId).row();
    } else if (section === "access") {
      const e = await this.db.enrollment.findUniqueOrThrow({
        where: { id },
        include: { user: true, course: true },
      });
      text =
        "🎓 Доступ\n" +
        clientName(e.user) +
        "\nКурс: " +
        e.course.title +
        "\nЗачисление: " +
        e.status +
        "\nДоступ: " +
        e.accessStatus +
        "\nСсылка: " +
        dash(e.telegramInviteLink) +
        "\nДействует до: " +
        (e.inviteExpiresAt ? date(e.inviteExpiresAt) : "—") +
        "\nВыдан: " +
        (e.accessGrantedAt ? date(e.accessGrantedAt) : "—") +
        "\nОшибка: " +
        dash(e.accessError);
      if (permitted(admin.role, section, true)) {
        button(k, "🔄 Повторить выдачу доступа", "a:retry:" + id).row();
        if (
          ["CREATING", "UNCERTAIN"].includes(e.accessStatus) ||
          e.accessError?.startsWith("UNCERTAIN:")
        )
          button(k, "Подтвердить ручную сверку", "a:reconcile:" + id).row();
      }
      button(k, "👤 Клиент", "a:card:clients:" + e.userId).row();
    } else if (section === "requests") {
      const r = await this.db.managerRequest.findUniqueOrThrow({
        where: { id },
        include: { user: true, course: true, assignee: true },
      });
      text =
        "💬 Запрос\n" +
        clientName(r.user) +
        "\nКурс: " +
        dash(r.course?.title) +
        "\n" +
        r.message +
        "\nСтатус: " +
        r.status +
        "\nОтветственный: " +
        dash(r.assignee?.name) +
        "\nСоздан: " +
        date(r.createdAt);
      if (permitted(admin.role, section, true) && r.status !== "RESOLVED") {
        button(
          k,
          "🙋 Взять в работу",
          "a:request:" + id + ":IN_PROGRESS",
        ).row();
        button(k, "✅ Закрыть", "a:request:" + id + ":RESOLVED").row();
      }
      button(k, "👤 Клиент", "a:card:clients:" + r.userId).row();
    } else if (section === "staff") {
      const a = await this.db.adminUser.findUniqueOrThrow({ where: { id } });
      text =
        "👨‍💼 " +
        a.name +
        "\nTelegram ID: " +
        dash(a.telegramId) +
        "\nРоль: " +
        a.role +
        "\nАктивность: " +
        a.active +
        "\nСоздан: " +
        date(a.createdAt);
      for (const role of ["OWNER", "ADMIN", "MANAGER"])
        button(
          k,
          "Роль → " + role,
          "a:staffconfirm:" + id + ":role:" + role,
        ).row();
      button(
        k,
        a.active ? "Отключить" : "Включить",
        "a:staffconfirm:" + id + ":active:" + !a.active,
      );
    } else if (section === "requisites") {
      if (!["KZ", "RU"].includes(id)) throw new AppError("Неизвестная страна");
      const r = await this.db.paymentMethodSetting.findUniqueOrThrow({
        where: { country: id as "KZ" | "RU" },
      });
      text =
        "💰 " +
        r.country +
        " / " +
        r.currency +
        "\nНазвание: " +
        r.title +
        "\nВключено: " +
        r.enabled +
        "\nИнструкция:\n" +
        r.instruction +
        "\nРеквизиты:\n" +
        r.requisites;
      this.edits(k, admin, section, id);
    } else throw new AppError("Карточка недоступна");
    await display(ctx, text, back(k, "a:menu:" + section));
  }
  async history(ctx: Context, admin: AdminUser, id: string, page: number) {
    await requireAdmin(this.db, admin.id, "clients");
    const p = pagination(
      await this.db.funnelEvent.count({ where: { userId: id } }),
      page,
    );
    const rows = await this.db.funnelEvent.findMany({
      where: { userId: id },
      skip: p.skip,
      take: p.take,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: { course: true },
    });
    const k = pager(
      new InlineKeyboard(),
      p.page,
      p.pages,
      (n) => "a:history:" + id + ":" + n,
    );
    await display(
      ctx,
      "🕘 История · " +
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
          .join("\n\n") || "Событий нет."),
      back(k, "a:card:clients:" + id),
    );
  }
  async status(ctx: Context, admin: AdminUser) {
    await requireAdmin(this.db, admin.id, "settings");
    let connected = true;
    try {
      await this.db.$queryRaw`SELECT 1`;
    } catch {
      connected = false;
    }
    const error = await this.db.telegramBotError.findFirst({
      orderBy: { createdAt: "desc" },
    });
    await display(
      ctx,
      "🤖 Технический статус\nТокен: " +
        (process.env.TELEGRAM_BOT_TOKEN ? "настроен" : "не настроен") +
        "\nБаза: " +
        (connected ? "подключена" : "ошибка") +
        "\nUsername: " +
        dash(
          ctx.me.username || this.username || process.env.TELEGRAM_BOT_USERNAME,
        ) +
        "\nUptime: " +
        Math.floor(process.uptime()) +
        " сек.\nАктивные сотрудники: " +
        (await this.db.adminUser.count({ where: { active: true } })) +
        "\nПоследняя ошибка: " +
        dash(error?.message),
      back(new InlineKeyboard(), "a:menu:settings"),
    );
  }
}
