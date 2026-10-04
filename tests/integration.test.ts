import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import {
  PrismaClient,
  AdminUser,
  Course,
  CourseCategory,
  User,
} from "@prisma/client";
import type { Update } from "grammy/types";
import { recordError } from "../src/lib/errors";
import { bootstrapOwner, requireAdmin } from "../src/services/auth";
import { AdminService } from "../src/services/admin";
import { PaymentService } from "../src/services/payments";
import { AccessService } from "../src/services/access";
import { Conversations, payload } from "../src/services/conversations";
import { AdminRepository } from "../src/repositories/admin";
import { GrammyGateway, TelegramGateway } from "../src/bot/gateway";
import { seedCatalog, catalog, funnelSeed } from "../src/services/catalog-seed";
import { content } from "../src/i18n";
import { createBot } from "../src/bot";
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite("administration with actual PostgreSQL", () => {
  const db = new PrismaClient({ datasourceUrl: url ?? "postgresql://unused" });
  const service = new AdminService(db),
    payments = new PaymentService(db),
    flows = new Conversations(db);
  let owner: AdminUser,
    admin: AdminUser,
    manager: AdminUser,
    category: CourseCategory,
    course: Course,
    user: User;
  beforeAll(async () => {
    if (!url || !new URL(url).pathname.endsWith("/course_funnel_test"))
      throw new Error("Dedicated test database required");
    expect(await db.courseCategory.count()).toBe(4);
    expect(await db.course.count()).toBe(15);
    expect(await db.courseTariff.count()).toBe(23);
    expect(await db.course.count({ where: { status: "DRAFT" } })).toBe(15);
    expect(await db.adminUser.count({ where: { role: "OWNER" } })).toBe(1);
  });
  beforeEach(async () => {
    await db.$executeRawUnsafe(
      'TRUNCATE "User","AdminUser","CourseCategory","Setting","PaymentMethodSetting","TelegramBotError","TelegramUpdate","WorkerLease","FunnelContent","BonusMaterial" CASCADE',
    );
    owner = (await bootstrapOwner(db, "1001"))!;
    admin = await db.adminUser.create({
      data: { name: "Admin", telegramId: 1002n, role: "ADMIN" },
    });
    manager = await db.adminUser.create({
      data: { name: "Manager", telegramId: 1003n, role: "MANAGER" },
    });
    category = await db.courseCategory.create({
      data: { slug: "test", code: "TEST", title: "Массаж" },
    });
    course = await db.course.create({
      data: {
        slug: "test",
        title: "Курс",
        shortDescription: "Кратко",
        fullDescription: "Полное описание",
        program: "Программа",
        duration: "Месяц",
        categoryId: category.id,
        telegramChannelId: "-1001234567890",
      },
    });
    user = await db.user.create({
      data: {
        telegramId: 2001n,
        firstName: "Анна",
        telegramUsername: "anna_test",
        phone: "+77001234567",
        selectedCourseId: course.id,
      },
    });
    for (const [country, currency] of [
      ["KZ", "KZT"],
      ["RU", "RUB"],
    ] as const)
      await db.paymentMethodSetting.create({
        data: { country, currency, title: "Test" },
      });
  });
  afterAll(() => db.$disconnect());
  const courseData = () => ({
    title: "Новый курс",
    shortDescription: "Кратко",
    fullDescription: "Подробно",
    program: "Теория",
    duration: "4 недели",
    categoryId: category.id,
    priceKZT: "25000",
    priceRUB: "5000",
    telegramChannelId: "-1001234567890",
    status: "DRAFT",
    sortOrder: 0,
  });
  const pending = () =>
    db.payment.create({
      data: {
        userId: user.id,
        courseId: course.id,
        amount: 100,
        currency: "KZT",
        country: "KZ",
        paymentMethod: "Kaspi",
        instruction: "",
        requisites: "",
        status: "PENDING_REVIEW",
        receiptFileId: "test_receipt",
        receiptType: "photo",
      },
    });
  const gateway = (): TelegramGateway => ({
    send: vi.fn(),
    receipt: vi.fn(),
    createInvite: vi.fn().mockResolvedValue("https://t.me/+unique"),
    revokeInvite: vi.fn(),
  });
  async function enrollment() {
    const p = await pending();
    await payments.review(owner.id, p.id, true);
    return db.enrollment.findUniqueOrThrow({ where: { paymentId: p.id } });
  }
  function harness(actor = 1001) {
    const bot = createBot("123456:mock", db);
    const calls: { method: string; payload: Record<string, unknown> }[] = [];
    let failingMethod: string | undefined;
    bot.api.config.use(async (_prev, method, p) => {
      calls.push({ method, payload: p as unknown as Record<string, unknown> });
      if (method === failingMethod)
        throw new Error(
          "Telegram bot123456:secret_token postgresql://user:password@host/db",
        );
      if (method === "getMe")
        return {
          ok: true,
          result: {
            id: 123456,
            is_bot: true,
            first_name: "Admin",
            username: "admin_test_bot",
          },
        } as never;
      if (method === "createChatInviteLink")
        return {
          ok: true,
          result: { invite_link: "https://t.me/+unique" },
        } as never;
      return {
        ok: true,
        result: {
          message_id: 42,
          date: 1,
          chat: { id: actor, type: "private" },
          text: "mock",
        },
      } as never;
    });
    let updateId = 1;
    const from = { id: actor, is_bot: false, first_name: "Tester" },
      chat = { id: actor, type: "private" as const };
    return {
      bot,
      calls,
      fail(method: string) {
        failingMethod = method;
      },
      async text(text: string, replayId?: number) {
        await bot.init();
        await bot.handleUpdate({
          update_id: replayId ?? updateId++,
          message: {
            message_id: updateId,
            date: 1,
            from,
            chat,
            text,
            ...(text.startsWith("/")
              ? {
                  entities: [
                    { type: "bot_command", offset: 0, length: text.length },
                  ],
                }
              : {}),
          },
        } as Update);
      },
      async click(data: string) {
        await bot.init();
        await bot.handleUpdate({
          update_id: updateId++,
          callback_query: {
            id: "cb" + updateId,
            from,
            chat_instance: "x",
            data,
            message: { message_id: 42, date: 1, chat, text: "menu" },
          },
        } as Update);
      },
      async media(message: Record<string, unknown>) {
        await bot.init();
        await bot.handleUpdate({
          update_id: updateId++,
          message: { message_id: updateId, date: 1, from, chat, ...message },
        } as Update);
      },
    };
  }
  it("bootstraps OWNER exactly once under concurrency", async () => {
    await Promise.all([bootstrapOwner(db, "3333"), bootstrapOwner(db, "3333")]);
    expect(
      await db.adminUser.count({ where: { telegramId: 3333n, role: "OWNER" } }),
    ).toBe(1);
  });
  it("does not reset an existing disabled owner on restart", async () => {
    await db.adminUser.update({
      where: { id: owner.id },
      data: { active: false },
    });
    expect((await bootstrapOwner(db, "1001"))?.active).toBe(false);
  });
  it("upgrades the configured legacy admin when there has never been an owner", async () => {
    await db.adminUser.update({
      where: { id: owner.id },
      data: { role: "ADMIN" },
    });
    expect((await bootstrapOwner(db, "1001"))?.role).toBe("OWNER");
  });
  it("denies inactive/nonexistent admin and checks manager write permissions", async () => {
    await expect(requireAdmin(db, "missing", "clients")).rejects.toThrow(
      "Команда недоступна",
    );
    await expect(
      requireAdmin(db, manager.id, "payments", true),
    ).rejects.toThrow();
    await db.adminUser.update({
      where: { id: admin.id },
      data: { active: false },
    });
    await expect(requireAdmin(db, admin.id, "clients")).rejects.toThrow();
  });
  it("protects the last OWNER from disable and demotion", async () => {
    await expect(
      service.changeStaff(owner.id, owner.id, { active: false }),
    ).rejects.toThrow("последнего OWNER");
    await expect(
      service.changeStaff(owner.id, owner.id, { role: "ADMIN" }),
    ).rejects.toThrow("последнего OWNER");
  });
  it("serializes simultaneous OWNER demotions", async () => {
    const second = (await bootstrapOwner(db, "4001"))!;
    const results = await Promise.allSettled([
      service.changeStaff(owner.id, owner.id, { role: "ADMIN" }),
      service.changeStaff(second.id, second.id, { role: "ADMIN" }),
    ]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(
      await db.adminUser.count({ where: { active: true, role: "OWNER" } }),
    ).toBe(1);
  });
  it("creates and edits categories with audit", async () => {
    const c = await service.save(admin.id, "category", {
      title: "Новое",
      description: "Описание",
      active: true,
      sortOrder: 8,
    });
    await service.save(
      owner.id,
      "category",
      {
        title: "Переименовано",
        description: null,
        active: false,
        sortOrder: 2,
      },
      c.id,
    );
    expect(
      await db.courseCategory.findUnique({ where: { id: c.id } }),
    ).toMatchObject({ title: "Переименовано", active: false, sortOrder: 2 });
    expect(await db.auditLog.count({ where: { entityId: c.id } })).toBe(2);
  });
  it("creates and edits prices/media/channel/archive individually", async () => {
    const c = await service.save(admin.id, "course", courseData());
    const tariff = await service.save(admin.id, "tariff", {
      courseId: c.id,
      code: "STANDARD",
      title: "Standard",
      priceKZT: "100",
      priceRUB: "20",
    });
    let state = await flows.begin(admin.id, "tariff", tariff.id, "priceKZT");
    state = await flows.input(admin.id, state.nonce, "26000.50");
    await flows.commit(admin.id, state.nonce);
    state = await flows.begin(admin.id, "course", c.id, "status");
    state = await flows.input(admin.id, state.nonce, "ARCHIVED");
    await flows.commit(admin.id, state.nonce);
    expect(await db.course.findUnique({ where: { id: c.id } })).toMatchObject({
      status: "ARCHIVED",
    });
    expect(
      (
        await db.courseTariff.findUniqueOrThrow({ where: { id: tariff.id } })
      ).priceKZT.toString(),
    ).toBe("26000.5");
    expect(
      await db.auditLog.count({
        where: { action: "COURSE_ARCHIVED", entityId: c.id },
      }),
    ).toBe(1);
  });
  it("creates/updates/deletes recommendation rules", async () => {
    const r = await service.save(admin.id, "rule", {
      experienceLevel: "BEGINNER",
      categoryId: category.id,
      learningGoal: null,
      courseId: course.id,
      priority: 10,
      active: true,
    });
    await service.save(
      admin.id,
      "rule",
      {
        experienceLevel: null,
        categoryId: null,
        learningGoal: null,
        courseId: course.id,
        priority: 20,
        active: false,
      },
      r.id,
    );
    expect(
      await db.recommendationRule.findUnique({ where: { id: r.id } }),
    ).toMatchObject({ active: false, priority: 20 });
    await service.deleteRule(admin.id, r.id);
    expect(await db.recommendationRule.count()).toBe(0);
  });
  it("approves once and creates a single pending access enrollment", async () => {
    const p = await pending();
    await Promise.all([
      payments.review(admin.id, p.id, true),
      payments.review(owner.id, p.id, true),
    ]);
    expect(await db.payment.findUnique({ where: { id: p.id } })).toMatchObject({
      status: "PAID",
      reviewedAt: expect.any(Date),
    });
    expect(await db.enrollment.count()).toBe(1);
    expect(
      await db.auditLog.count({ where: { action: "PAYMENT_APPROVED" } }),
    ).toBe(1);
    expect((await db.enrollment.findFirst())?.accessStatus).toBe("PENDING");
    expect(await db.outboxJob.count()).toBe(0);
  });
  it("rejects with reason and no enrollment", async () => {
    const p = await pending();
    await payments.review(admin.id, p.id, false, "Чек не читается");
    expect(await db.payment.findUnique({ where: { id: p.id } })).toMatchObject({
      status: "REJECTED",
      rejectionReason: "Чек не читается",
      reviewedByAdminId: admin.id,
    });
    expect(await db.enrollment.count()).toBe(0);
    expect(
      await db.auditLog.count({ where: { action: "PAYMENT_REJECTED" } }),
    ).toBe(1);
  });
  it("rejects forbidden payment transitions and manager approval", async () => {
    const p = await pending();
    await expect(payments.review(manager.id, p.id, true)).rejects.toThrow();
    await payments.review(admin.id, p.id, false, "Неверная сумма");
    await expect(payments.review(admin.id, p.id, true)).rejects.toThrow();
  });
  it("approves two payments for the same course without duplicating enrollment", async () => {
    const a = await pending(),
      b = await pending();
    await Promise.all([
      payments.review(owner.id, a.id, true),
      payments.review(admin.id, b.id, true),
    ]);
    expect(await db.enrollment.count()).toBe(1);
  });
  it("creates one invite and persists it before any further action", async () => {
    const e = await enrollment(),
      g = gateway(),
      access = new AccessService(db, g);
    const attempts = await Promise.allSettled([
      access.retry(e.id, owner.id),
      access.retry(e.id, admin.id),
    ]);
    expect(attempts.some((x) => x.status === "fulfilled")).toBe(true);
    expect(g.createInvite).toHaveBeenCalledTimes(1);
    expect(
      await db.enrollment.findUnique({ where: { id: e.id } }),
    ).toMatchObject({
      accessStatus: "GRANTED",
      telegramInviteLink: "https://t.me/+unique",
    });
    await access.retry(e.id, owner.id);
    expect(g.createInvite).toHaveBeenCalledTimes(1);
    expect(
      await db.auditLog.count({ where: { action: "ACCESS_GRANTED" } }),
    ).toBe(1);
    expect(g.send).not.toHaveBeenCalled();
  });
  it("records Telegram failure and allows manual retry for known API rejection", async () => {
    const e = await enrollment(),
      g = gateway();
    vi.mocked(g.createInvite).mockRejectedValueOnce(
      new Error("403 bot lacks invite permission"),
    );
    const access = new AccessService(db, g);
    expect((await access.retry(e.id, owner.id)).accessStatus).toBe("FAILED");
    expect(await db.telegramBotError.count()).toBe(1);
    expect((await access.retry(e.id, owner.id)).accessStatus).toBe("GRANTED");
  });
  it("requires manual reconciliation after ambiguous timeout", async () => {
    const e = await enrollment(),
      g = gateway();
    vi.mocked(g.createInvite).mockRejectedValueOnce(
      new Error("network timeout"),
    );
    const access = new AccessService(db, g);
    await access.retry(e.id, owner.id);
    await expect(access.retry(e.id, owner.id)).rejects.toThrow("сверку");
    expect((await access.retry(e.id, owner.id, true)).accessStatus).toBe(
      "GRANTED",
    );
  });
  it("denies MANAGER access retry", async () => {
    const e = await enrollment();
    await expect(
      new AccessService(db, gateway()).retry(e.id, manager.id),
    ).rejects.toThrow();
  });
  it("cannot bypass an in-flight invite operation through reconciliation", async () => {
    const e = await enrollment();
    await db.enrollment.update({
      where: { id: e.id },
      data: { accessStatus: "CREATING", accessStartedAt: new Date() },
    });
    const g = gateway();
    await expect(
      new AccessService(db, g).retry(e.id, owner.id, true),
    ).rejects.toThrow("уже выполняется");
    expect(g.createInvite).not.toHaveBeenCalled();
  });
  it("uses official API member_limit and expiry", async () => {
    const h = harness();
    await h.bot.init();
    await new GrammyGateway(h.bot.api).createInvite(
      "-1001234567890",
      "test",
      new Date(Date.now() + 3600000),
    );
    expect(
      h.calls.find((x) => x.method === "createChatInviteLink")?.payload,
    ).toMatchObject({ member_limit: 1, expire_date: expect.any(Number) });
  });
  it("OWNER creates staff; ADMIN and MANAGER cannot", async () => {
    const a = await service.save(owner.id, "admin", {
      name: "Second",
      telegramId: "5555",
      role: "ADMIN",
    });
    expect(
      await db.adminUser.findUnique({ where: { id: a.id } }),
    ).toMatchObject({ telegramId: 5555n, role: "ADMIN", active: true });
    for (const actor of [admin, manager])
      await expect(
        service.save(actor.id, "admin", {
          name: "Bad",
          telegramId: "6666",
          role: "ADMIN",
        }),
      ).rejects.toThrow();
  });
  it("staff disabled/enabled/role changes are audited", async () => {
    await service.changeStaff(owner.id, admin.id, { active: false });
    await service.changeStaff(owner.id, admin.id, { active: true });
    await service.changeStaff(owner.id, admin.id, { role: "MANAGER" });
    expect(
      await db.auditLog.findMany({ where: { entityId: admin.id } }),
    ).toHaveLength(3);
  });
  it("manager edits client card and handles a manager request", async () => {
    await service.save(
      manager.id,
      "client",
      { ...user, firstName: "Анна 2" },
      user.id,
    );
    const r = await db.managerRequest.create({
      data: { userId: user.id, message: "Вопрос", stage: "NEW" },
    });
    await service.request(manager.id, r.id, "IN_PROGRESS");
    await service.request(manager.id, r.id, "RESOLVED");
    expect(
      await db.managerRequest.findUnique({ where: { id: r.id } }),
    ).toMatchObject({ status: "RESOLVED", assignedToAdminId: manager.id });
  });
  it("prevents stealing a request already assigned to another admin", async () => {
    const r = await db.managerRequest.create({
      data: { userId: user.id, message: "Вопрос", stage: "NEW" },
    });
    await service.request(manager.id, r.id, "IN_PROGRESS");
    await expect(
      service.request(admin.id, r.id, "IN_PROGRESS"),
    ).rejects.toThrow("другим");
  });
  it("OWNER-only requisites use separate currencies and audit", async () => {
    const data = {
      country: "KZ",
      currency: "KZT",
      title: "Kaspi",
      instruction: "Оплатить",
      requisites: "Задано владельцем",
      enabled: true,
    };
    await service.save(owner.id, "requisites", data);
    await expect(service.save(admin.id, "requisites", data)).rejects.toThrow();
    expect(
      await db.paymentMethodSetting.findUnique({ where: { country: "RU" } }),
    ).toMatchObject({ currency: "RUB", enabled: false, requisites: "" });
    expect(
      await db.auditLog.count({
        where: { action: "PAYMENT_SETTINGS_UPDATED" },
      }),
    ).toBe(1);
  });
  it("settings wizard updates only selected field", async () => {
    let s = await flows.begin(
      owner.id,
      "settings",
      "config",
      "inviteLifetimeHours",
    );
    s = await flows.input(owner.id, s.nonce, "48");
    await flows.commit(owner.id, s.nonce);
    expect(await service.settings()).toMatchObject({
      inviteLifetimeHours: 48,
      projectName: "Course Sales Funnel",
    });
  });
  it("wizard persists after service restart and expires safely", async () => {
    const s = await flows.begin(admin.id, "category");
    expect((await new Conversations(db).state(admin.id)).nonce).toBe(s.nonce);
    await db.adminConversationState.update({
      where: { adminId: admin.id },
      data: { expiresAt: new Date(0) },
    });
    await expect(flows.state(admin.id)).rejects.toThrow("истёк");
    expect(await db.adminConversationState.count()).toBe(0);
  });
  it("cancel clears state and stale/repeated buttons cannot commit", async () => {
    let s = await flows.begin(admin.id, "category");
    const old = s.nonce;
    s = await flows.input(admin.id, s.nonce, "Новое");
    await expect(flows.input(admin.id, old, "Подмена")).rejects.toThrow(
      "устарела",
    );
    await flows.cancel(admin.id);
    await expect(flows.commit(admin.id, s.nonce)).rejects.toThrow();
    expect(await db.courseCategory.count()).toBe(1);
  });
  it("validates role again between wizard steps", async () => {
    const s = await flows.begin(admin.id, "course");
    await db.adminUser.update({
      where: { id: admin.id },
      data: { role: "MANAGER" },
    });
    await expect(flows.input(admin.id, s.nonce, "Bad")).rejects.toThrow(
      "недоступна",
    );
  });
  it("replayed Telegram text update after a restart cannot advance the next wizard step", async () => {
    const h = harness();
    await h.click("a:new:category");
    await h.text("Название", 99);
    await h.text("Название", 99);
    const state = await new Conversations(db).state(owner.id);
    expect(state.step).toBe(1);
    expect(payload(state).data.title).toBe("Название");
    expect(payload(state).data.description).toBeUndefined();
  });
  it("course wizard supports RU/KZ and allows preview field correction", async () => {
    let s = await flows.begin(admin.id, "course");
    const values = [
      category.id,
      "Course",
      "-",
      "Short",
      "-",
      "Full",
      "-",
      "Program",
      "-",
      "Month",
      "-",
      { imageFileId: "photo_id", imageUrl: null },
      { demoFileId: "video_id", demoVideoUrl: null },
      "-1001234567890",
      "ACTIVE",
    ];
    expect(payload(s).keys).toHaveLength(15);
    for (const value of values) s = await flows.input(admin.id, s.nonce, value);
    s = await flows.editPreview(admin.id, s.nonce, "title");
    s = await flows.input(admin.id, s.nonce, "Course");
    const [a, b] = await Promise.allSettled([
      flows.commit(admin.id, s.nonce),
      flows.commit(admin.id, s.nonce),
    ]);
    expect([a, b].filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(
      await db.course.findFirst({ where: { title: "Course" } }),
    ).toMatchObject({
      imageFileId: "photo_id",
      demoFileId: "video_id",
      status: "ACTIVE",
    });
  });
  it("paginates clients and searches username, phone and telegram ID", async () => {
    for (let i = 0; i < 6; i++)
      await db.user.create({
        data: { telegramId: BigInt(3000 + i), firstName: "Client" + i },
      });
    const repo = new AdminRepository(db);
    expect((await repo.list("clients", "all", 0)).rows).toHaveLength(5);
    expect((await repo.list("clients", "all", 1)).rows).toHaveLength(2);
    for (const term of ["Анна", "@anna_test", "+77001234567", "2001"])
      expect(
        (await repo.list("clients", "search", 0, undefined, term)).rows.map(
          (x) => x.id,
        ),
      ).toContain(user.id);
  });
  it("paginates all mandated entities", async () => {
    const repo = new AdminRepository(db);
    for (let i = 0; i < 6; i++) {
      const c = await db.course.create({
        data: { ...course, id: undefined, slug: "extra-" + i },
      });
      const p = await db.payment.create({
        data: {
          userId: user.id,
          courseId: c.id,
          amount: 100,
          currency: "KZT",
          country: "KZ",
          paymentMethod: "Test",
          instruction: "",
          requisites: "",
          status: "PAID",
        },
      });
      await db.enrollment.create({
        data: { userId: user.id, courseId: c.id, paymentId: p.id },
      });
      await db.managerRequest.create({
        data: { userId: user.id, message: "Test", stage: "NEW" },
      });
      await db.adminUser.create({
        data: { name: "Extra " + i, telegramId: BigInt(9000 + i) },
      });
    }
    for (const section of [
      "courses",
      "payments",
      "access",
      "requests",
      "staff",
    ] as const) {
      const first = await repo.list(section, "all", 0),
        second = await repo.list(section, "all", 1);
      expect(first.rows).toHaveLength(5);
      expect(second.rows.length).toBeGreaterThan(0);
      expect((await repo.list(section, "all", 9999)).page).toBe(1);
      expect(first.pages).toBe(2);
      expect(
        first.rows.some((a) => second.rows.some((b) => a.id === b.id)),
      ).toBe(false);
    }
  });
  it("statistics return zeros and keep KZT/RUB separate", async () => {
    await db.user.delete({ where: { id: user.id } });
    expect(await new AdminRepository(db).stats()).toContain("Клиенты: 0");
    user = await db.user.create({
      data: { telegramId: 2001n, firstName: "Test" },
    });
    const a = await pending();
    await payments.review(owner.id, a.id, true);
    const b = await db.payment.create({
      data: {
        userId: user.id,
        courseId: course.id,
        amount: 20,
        country: "RU",
        currency: "RUB",
        paymentMethod: "Bank",
        instruction: "",
        requisites: "",
        status: "PENDING_REVIEW",
      },
    });
    await payments.review(owner.id, b.id, true);
    const stats = await new AdminRepository(db).stats();
    expect(stats).toContain("Выручка KZT: 100");
    expect(stats).toContain("Выручка RUB: 20");
  });
  it("unauthorized /admin and callback show exact denial without menu", async () => {
    const h = harness(9999);
    await h.text("/admin");
    await h.click("a:home");
    expect(h.calls.find((x) => x.method === "sendMessage")?.payload.text).toBe(
      "Команда недоступна.",
    );
    expect(JSON.stringify(h.calls)).not.toContain("⚙️ Админ-панель");
  });
  it("/admin uses menu navigation edits and every callback rechecks active", async () => {
    const h = harness();
    await h.text("/admin");
    await h.click("a:menu:courses");
    expect(h.calls.some((x) => x.method === "editMessageText")).toBe(true);
    await db.adminUser.update({
      where: { id: owner.id },
      data: { active: false },
    });
    await h.click("a:menu:payments");
    expect(h.calls.at(-1)?.payload.text).toBe("Команда недоступна.");
  });
  it("MANAGER forged callbacks cannot alter courses or payments", async () => {
    const p = await pending(),
      h = harness(1003);
    await h.click("a:approve:" + p.id);
    await h.click("a:new:course");
    await h.click("a:menu:staff");
    expect(
      (await db.payment.findUniqueOrThrow({ where: { id: p.id } })).status,
    ).toBe("PENDING_REVIEW");
    expect(await db.adminConversationState.count()).toBe(0);
  });
  it("Telegram category wizard and /cancel work", async () => {
    const h = harness();
    await h.click("a:new:category");
    await h.text("Telegram category");
    await h.text("-");
    await h.text("Description");
    await h.text("-");
    let s = await flows.state(owner.id);
    await h.click("w:" + s.nonce + ":pick:true");
    await h.text("2");
    s = await flows.state(owner.id);
    await h.click("w:" + s.nonce + ":save:ok");
    expect(
      await db.courseCategory.findFirst({
        where: { title: "Telegram category" },
      }),
    ).toBeTruthy();
    await h.click("a:new:course");
    await h.text("/cancel");
    expect(await db.adminConversationState.count()).toBe(0);
  });
  it("Telegram receipt media, search and own reason rejection work", async () => {
    const p = await pending(),
      h = harness();
    await h.click("a:receipt:" + p.id);
    expect(
      h.calls.some(
        (x) => x.method === "sendPhoto" && x.payload.photo === "test_receipt",
      ),
    ).toBe(true);
    await h.click("a:new:search");
    await h.text("@anna_test");
    expect(JSON.stringify(h.calls)).toContain("Анна");
    await h.click("a:reason:" + p.id + ":other");
    await h.text("Проверено вручную");
    const s = await flows.state(owner.id);
    await h.click("w:" + s.nonce + ":save:ok");
    expect(
      (await db.payment.findUniqueOrThrow({ where: { id: p.id } }))
        .rejectionReason,
    ).toBe("Проверено вручную");
  });
  it("Telegram cover/video uploads persist file_id without downloads", async () => {
    const h = harness();
    await h.click("a:edit:course:" + course.id + ":cover");
    await h.media({
      photo: [
        {
          file_id: "photo-id",
          file_unique_id: "unique",
          width: 600,
          height: 400,
        },
      ],
    });
    let s = await flows.state(owner.id);
    await h.click("w:" + s.nonce + ":save:ok");
    await h.click("a:edit:course:" + course.id + ":demo");
    await h.media({
      document: {
        file_id: "video-doc",
        file_unique_id: "v",
        mime_type: "video/mp4",
        file_name: "demo.mp4",
      },
    });
    s = await flows.state(owner.id);
    await h.click("w:" + s.nonce + ":save:ok");
    expect(
      await db.course.findUnique({ where: { id: course.id } }),
    ).toMatchObject({ imageFileId: "photo-id", demoFileId: "video-doc" });
    await h.click("a:media:demo:" + course.id);
    expect(
      h.calls.some(
        (x) =>
          x.method === "sendDocument" && x.payload.document === "video-doc",
      ),
    ).toBe(true);
    expect(h.calls.some((x) => x.method === "getFile")).toBe(false);
  });
  it("invalid media/callback returns friendly response and continues", async () => {
    const h = harness();
    await h.click("a:edit:course:" + course.id + ":cover");
    await h.media({
      document: {
        file_id: "bad",
        file_unique_id: "x",
        mime_type: "application/pdf",
      },
    });
    expect(JSON.stringify(h.calls)).toContain("Неподдерживаемый файл");
    await h.click("a:list:payments:forged:0");
    await h.text("/admin");
    expect(h.calls.at(-1)?.payload.text).toContain("Админ-панель");
  });
  it("no client /start handler, client registration or receipt collection", async () => {
    const count = await db.user.count(),
      h = harness(9999);
    await h.text("/start");
    await h.media({
      photo: [{ file_id: "client", file_unique_id: "c", width: 1, height: 1 }],
    });
    expect(await db.user.count()).toBe(count);
    expect(await db.payment.count()).toBe(0);
  });
  it("Prisma and Telegram errors are logged without exposing details to the admin", async () => {
    const h = harness();
    await h.click("a:card:courses:missing");
    expect(h.calls.at(-1)?.payload.text).toBe(
      "Не удалось выполнить действие. Попробуйте ещё раз.",
    );
    h.fail("sendPhoto");
    expect(await db.telegramBotError.count()).toBe(1);
    const p = await pending();
    await h.click("a:receipt:" + p.id);
    const errors = await db.telegramBotError.findMany();
    expect(h.calls.some((x) => x.method === "sendPhoto")).toBe(true);
    expect(errors.map((x) => x.message)).toHaveLength(2);
    expect(JSON.stringify(errors)).not.toContain("secret_token");
    expect(JSON.stringify(errors)).not.toContain("user:password");
    expect(typeof errors[0].context).toBe("object");
    await h.text("/admin");
    expect(h.calls.at(-1)?.payload.text).toContain("Админ-панель");
  });
  it("all section menus and cards render with callback sizes under 64", async () => {
    const p = await pending(),
      e = await enrollment(),
      r = await db.managerRequest.create({
        data: { userId: user.id, message: "Test", stage: "NEW" },
      });
    const h = harness();
    for (const section of [
      "stats",
      "clients",
      "courses",
      "categories",
      "rules",
      "payments",
      "access",
      "requests",
      "staff",
      "requisites",
      "settings",
    ])
      await h.click("a:menu:" + section);
    for (const [section, id] of [
      ["clients", user.id],
      ["courses", course.id],
      ["categories", category.id],
      ["payments", p.id],
      ["access", e.id],
      ["requests", r.id],
      ["staff", admin.id],
      ["requisites", "KZ"],
    ])
      await h.click("a:card:" + section + ":" + id);
    expect(await db.telegramBotError.count()).toBe(0);
    for (const call of h.calls) {
      const markup = call.payload.reply_markup as
        { inline_keyboard?: { callback_data?: string }[][] } | undefined;
      for (const row of markup?.inline_keyboard ?? [])
        for (const b of row)
          if (b.callback_data)
            expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
    }
  });
  it("seeds every real course and all exact tariff prices, with empty KZ marketing and no invented media", async () => {
    await seedCatalog(db);
    for (const [slug, title, categoryCode, kzt, rub] of catalog) {
      const c = await db.course.findUniqueOrThrow({
        where: { slug },
        include: {
          category: true,
          translations: true,
          tariffs: { include: { translations: true } },
        },
      });
      expect(c.category.code).toBe(categoryCode);
      expect(content(c.translations, "RU", "title")).toBe(title);
      expect(content(c.translations, "KZ", "title")).toBe(title);
      expect(c.translations.find((t) => t.language === "KZ")?.title).toBe("");
      expect(c.telegramChannelId).toBeNull();
      const expected =
        categoryCode === "PROFESSIONAL"
          ? [
              ["SELF", 30000, 6000],
              ["CURATOR", 50000, 10000],
              ["MENTORSHIP", 75000, 15000],
            ]
          : [["STANDARD", kzt, rub]];
      expect(c.tariffs).toHaveLength(expected.length);
      for (const [code, kzt, rub] of expected) {
        const tariff = c.tariffs.find((t) => t.code === code)!;
        expect(tariff.priceKZT.toString()).toBe(String(kzt));
        expect(tariff.priceRUB.toString()).toBe(String(rub));
        expect(tariff.translations).toHaveLength(2);
      }
    }
    expect(await db.courseTariff.count()).toBe(23);
    expect(await db.recommendationRule.count()).toBe(16);
    expect(await db.bonusMaterial.count()).toBe(3);
    expect(
      await db.bonusMaterial.count({
        where: { OR: [{ fileId: { not: null } }, { url: { not: null } }] },
      }),
    ).toBe(0);
    for (const [key, , text] of funnelSeed)
      expect(
        (
          await db.funnelContent.findUniqueOrThrow({
            where: { key_language: { key, language: "RU" } },
          })
        ).text,
      ).toBe(text);
  });
  it("seed remains idempotent and preserves edited prices, translations and funnel content", async () => {
    await seedCatalog(db);
    const tariff = await db.courseTariff.findFirstOrThrow();
    await db.courseTariff.update({
      where: { id: tariff.id },
      data: { priceKZT: "12345" },
    });
    const text = await db.courseTranslation.findFirstOrThrow({
      where: { language: "KZ" },
    });
    await db.courseTranslation.update({
      where: { id: text.id },
      data: { title: "Бекітілген атау" },
    });
    const f = await db.funnelContent.findUniqueOrThrow({
      where: { key_language: { key: "WELCOME", language: "RU" } },
    });
    await db.funnelContent.update({
      where: { id: f.id },
      data: { text: "Edited" },
    });
    await seedCatalog(db);
    expect(await db.courseTariff.count()).toBe(23);
    expect(
      (
        await db.courseTariff.findUniqueOrThrow({ where: { id: tariff.id } })
      ).priceKZT.toString(),
    ).toBe("12345");
    expect(
      (await db.courseTranslation.findUniqueOrThrow({ where: { id: text.id } }))
        .title,
    ).toBe("Бекітілген атау");
    expect(
      (await db.funnelContent.findUniqueOrThrow({ where: { id: f.id } })).text,
    ).toBe("Edited");
  });
  it("persists language switching and renders KZ menu/wizard after bot restart", async () => {
    const h = harness();
    await h.click("a:lang:KZ");
    expect(
      (await db.adminUser.findUniqueOrThrow({ where: { id: owner.id } }))
        .language,
    ).toBe("KZ");
    expect(JSON.stringify(h.calls)).toContain("Әкімші панелі");
    const restarted = harness();
    await restarted.text("/admin");
    await restarted.click("a:new:course");
    expect(JSON.stringify(restarted.calls)).toContain("Қадам");
    expect(JSON.stringify(restarted.calls)).toContain("Бағыт");
    await restarted.click("a:lang:RU");
    expect(JSON.stringify(restarted.calls)).toContain("Админ-панель");
  });
  it("lets MANAGER select language but rejects forged tariff/funnel/bonus/settings mutations", async () => {
    const h = harness(1003);
    await h.click("a:lang:KZ");
    expect(
      (await db.adminUser.findUniqueOrThrow({ where: { id: manager.id } }))
        .language,
    ).toBe("KZ");
    for (const section of ["tariffs", "funnel", "bonuses", "settings"])
      await h.click("a:menu:" + section);
    await h.click("a:new:tariff");
    await h.click("a:tr:ct:" + course.id + ":KZ");
    expect(await db.adminConversationState.count()).toBe(0);
    expect(await db.courseTranslation.count()).toBe(0);
    expect(JSON.stringify(h.calls)).toContain("қолжетімсіз");
  });
  it("edits RU/KZ course content independently and preserves KZ on metadata changes", async () => {
    const c = await service.save(admin.id, "course", {
      ...courseData(),
      titleKZ: "Қазақша курс",
    });
    const kz = await service.translation(admin.id, "ct", c.id, "KZ");
    let state = await flows.begin(admin.id, "ct", kz.id, "fullDescription");
    state = await flows.input(admin.id, state.nonce, "Қазақша толық сипаттама");
    await flows.commit(admin.id, state.nonce);
    state = await flows.begin(admin.id, "course", c.id, "status");
    state = await flows.input(admin.id, state.nonce, "ACTIVE");
    await flows.commit(admin.id, state.nonce);
    const texts = await db.courseTranslation.findMany({
      where: { courseId: c.id },
    });
    expect(texts.find((t) => t.language === "RU")?.fullDescription).toBe(
      courseData().fullDescription,
    );
    expect(texts.find((t) => t.language === "KZ")).toMatchObject({
      title: "Қазақша курс",
      fullDescription: "Қазақша толық сипаттама",
    });
    expect(content(texts, "KZ", "program")).toBe(courseData().program);
    expect(
      await db.auditLog.count({
        where: { entityId: kz.id, action: "COURSE_UPDATED" },
      }),
    ).toBe(1);
  });
  it("protects required RU title and allows clearing KZ title with fallback", async () => {
    const ru = await service.translation(owner.id, "ct", course.id, "RU");
    await expect(
      service.save(owner.id, "ct", { ...ru, title: "" }, ru.id),
    ).rejects.toThrow();
    expect(
      (await db.courseTranslation.findUniqueOrThrow({ where: { id: ru.id } }))
        .title,
    ).toBe("Курс");
    const kz = await service.translation(owner.id, "ct", course.id, "KZ");
    await service.save(owner.id, "ct", { ...kz, title: "Атау" }, kz.id);
    await service.save(owner.id, "ct", { ...kz, title: "" }, kz.id);
    expect(
      content(
        await db.courseTranslation.findMany({ where: { courseId: course.id } }),
        "KZ",
        "title",
      ),
    ).toBe("Курс");
  });
  it("creates tariffs with exact decimals and safely disables referenced tariffs", async () => {
    const a = await service.save(admin.id, "tariff", {
      courseId: course.id,
      code: "SELF",
      title: "Самостоятельный",
      priceKZT: "30000",
      priceRUB: "6000",
    });
    const p = await pending();
    await db.payment.update({ where: { id: p.id }, data: { tariffId: a.id } });
    await payments.review(owner.id, p.id, true);
    expect(
      (await db.enrollment.findUniqueOrThrow({ where: { paymentId: p.id } }))
        .tariffId,
    ).toBe(a.id);
    await service.deleteTariff(admin.id, a.id);
    expect(
      (await db.courseTariff.findUniqueOrThrow({ where: { id: a.id } })).active,
    ).toBe(false);
    expect(
      (
        await db.payment.findUniqueOrThrow({ where: { id: p.id } })
      ).amount.toString(),
    ).toBe("100");
    const b = await service.save(admin.id, "tariff", {
      courseId: course.id,
      code: "CURATOR",
      title: "С куратором",
      priceKZT: "50000",
      priceRUB: "10000",
    });
    await service.deleteTariff(admin.id, b.id);
    expect(
      await db.courseTariff.findUnique({ where: { id: b.id } }),
    ).toBeNull();
  });
  it("rejects mismatched course/tariff relations before approving payment", async () => {
    const other = await service.save(admin.id, "course", courseData());
    const tariff = await service.save(admin.id, "tariff", {
      courseId: other.id,
      code: "STANDARD",
      title: "Standard",
      priceKZT: "1",
      priceRUB: "1",
    });
    const p = await pending();
    await db.payment.update({
      where: { id: p.id },
      data: { tariffId: tariff.id },
    });
    await expect(payments.review(owner.id, p.id, true)).rejects.toThrow(
      "не принадлежит",
    );
    expect(
      (await db.payment.findUniqueOrThrow({ where: { id: p.id } })).status,
    ).toBe("PENDING_REVIEW");
    expect(await db.enrollment.count()).toBe(0);
  });
  it("edits funnel language content transactionally through Telegram", async () => {
    await seedCatalog(db);
    const f = await db.funnelContent.findUniqueOrThrow({
      where: { key_language: { key: "WELCOME", language: "KZ" } },
    });
    const h = harness(1002);
    await h.click("a:fstage:WELCOME");
    await h.click("a:list:funnel:WELCOME_KZ:0");
    await h.click("a:card:funnel:" + f.id);
    expect(JSON.stringify(h.calls)).toContain("Перевод KZ не заполнен");
    await h.click("a:edit:funnel:" + f.id + ":text");
    await h.text("Сәлеметсіз бе!");
    const state = await flows.state(admin.id);
    await h.click("w:" + state.nonce + ":save:ok");
    expect(
      (await db.funnelContent.findUniqueOrThrow({ where: { id: f.id } })).text,
    ).toBe("Сәлеметсіз бе!");
    expect(
      await db.auditLog.count({ where: { action: "FUNNEL_CONTENT_UPDATED" } }),
    ).toBe(1);
    expect(
      (
        await db.funnelContent.findUniqueOrThrow({
          where: { key_language: { key: "WELCOME", language: "RU" } },
        })
      ).text,
    ).toBe(funnelSeed[0][2]);
  });
  it("uploads bonus video/document file_id and edits bonus translations", async () => {
    await seedCatalog(db);
    const h = harness();
    for (const [code, media, fileId] of [
      [
        "PROFESSIONAL_BASIC_VIDEO",
        {
          video: {
            file_id: "bonus-video",
            file_unique_id: "v",
            width: 10,
            height: 10,
            duration: 10,
          },
        },
        "bonus-video",
      ],
      [
        "FAMILY_SAFE_CHECKLIST",
        {
          document: {
            file_id: "bonus-pdf",
            file_unique_id: "d",
            mime_type: "application/pdf",
          },
        },
        "bonus-pdf",
      ],
    ] as const) {
      const b = await db.bonusMaterial.findUniqueOrThrow({ where: { code } });
      await h.click("a:edit:bonus:" + b.id + ":media");
      await h.media(media);
      const state = await flows.state(owner.id);
      await h.click("w:" + state.nonce + ":save:ok");
      expect(
        (await db.bonusMaterial.findUniqueOrThrow({ where: { id: b.id } }))
          .fileId,
      ).toBe(fileId);
      await h.click("a:bmedia:" + b.id);
      await h.click("a:tr:bt:" + b.id + ":KZ");
    }
    expect(
      h.calls.some(
        (c) => c.method === "sendVideo" && c.payload.video === "bonus-video",
      ),
    ).toBe(true);
    expect(
      h.calls.some(
        (c) =>
          c.method === "sendDocument" && c.payload.document === "bonus-pdf",
      ),
    ).toBe(true);
    expect(h.calls.some((c) => c.method === "getFile")).toBe(false);
    expect(
      await db.auditLog.count({ where: { action: "BONUS_UPDATED" } }),
    ).toBe(2);
  });
  it("stores client language/segments and filters RU/KZ clients and tariff pages", async () => {
    await db.user.update({
      where: { id: user.id },
      data: {
        language: "KZ",
        primaryGoal: "BEAUTY",
        beautyProfession: "NAILS",
      },
    });
    const repo = new AdminRepository(db);
    expect(
      (await repo.list("clients", "KZ", 0)).rows.map((r) => r.id),
    ).toContain(user.id);
    expect((await repo.list("clients", "RU", 0)).total).toBe(0);
    for (let i = 0; i < 7; i++)
      await service.save(admin.id, "tariff", {
        courseId: course.id,
        code: "T" + i,
        title: "Tariff" + i,
        priceKZT: "1",
        priceRUB: "2",
      });
    expect((await repo.list("tariffs", "all", 0, course.id)).rows).toHaveLength(
      5,
    );
    expect((await repo.list("tariffs", "all", 1, course.id)).rows).toHaveLength(
      2,
    );
    expect(await repo.stats()).toContain("Бьюти: 1");
    expect(await repo.stats("KZ")).toContain("Бүгін");
  });
  it("provides reminder/trial/expert settings without activating client sends", async () => {
    expect(await service.settings()).toMatchObject({
      funnelDelayHours: 3,
      demoDelayHours: 3,
      paymentDelayHours: 3,
      reminderMaxAttempts: 3,
      trialEnabled: false,
      expertContact: "",
    });
    let state = await flows.begin(
      owner.id,
      "settings",
      "config",
      "expertContact",
    );
    state = await flows.input(owner.id, state.nonce, "@expert_contact");
    await flows.commit(owner.id, state.nonce);
    expect((await service.settings()).expertContact).toBe("@expert_contact");
    expect(await db.outboxJob.count()).toBe(0);
  });
  it("rejects stale price editors instead of overwriting another administrator's changes", async () => {
    const tariff = await service.save(admin.id, "tariff", {
      courseId: course.id,
      code: "SELF",
      title: "Self",
      priceKZT: "30000",
      priceRUB: "6000",
    });
    let first = await flows.begin(admin.id, "tariff", tariff.id, "priceKZT");
    let second = await flows.begin(owner.id, "tariff", tariff.id, "priceRUB");
    first = await flows.input(admin.id, first.nonce, "35000");
    second = await flows.input(owner.id, second.nonce, "7000");
    await flows.commit(admin.id, first.nonce);
    await expect(flows.commit(owner.id, second.nonce)).rejects.toThrow(
      "Данные изменились",
    );
    const row = await db.courseTariff.findUniqueOrThrow({
      where: { id: tariff.id },
    });
    expect(row.priceKZT.toString()).toBe("35000");
    expect(row.priceRUB.toString()).toBe("6000");
    expect(
      await db.adminConversationState.findUnique({
        where: { adminId: owner.id },
      }),
    ).toBeTruthy();
  });
  it("creates and reprices a tariff through Telegram with confirmation and before/after audit", async () => {
    const h = harness();
    await h.click("a:tnew:" + course.id);
    for (const text of ["SELF", "Самостоятельный", "-", "-", "30000", "6000"])
      await h.text(text);
    let state = await flows.state(owner.id);
    await h.click("w:" + state.nonce + ":pick:true");
    await h.text("0");
    expect(await db.courseTariff.count()).toBe(0);
    state = await flows.state(owner.id);
    await h.click("w:" + state.nonce + ":save:ok");
    const tariff = await db.courseTariff.findFirstOrThrow();
    await h.click("a:edit:tariff:" + tariff.id + ":priceKZT");
    await h.text("35000,50");
    expect(
      (
        await db.courseTariff.findUniqueOrThrow({ where: { id: tariff.id } })
      ).priceKZT.toString(),
    ).toBe("30000");
    state = await flows.state(owner.id);
    await h.click("w:" + state.nonce + ":save:ok");
    expect(
      (
        await db.courseTariff.findUniqueOrThrow({ where: { id: tariff.id } })
      ).priceKZT.toString(),
    ).toBe("35000.5");
    expect(
      (
        await db.auditLog.findFirstOrThrow({
          where: { entityId: tariff.id, action: "TARIFF_UPDATED" },
        })
      ).metadata,
    ).toMatchObject({
      before: { priceKZT: "30000" },
      after: { priceKZT: "35000.5" },
    });
    expect(await db.telegramBotError.count()).toBe(0);
  });
  it("keeps long error context as valid redacted JSON", async () => {
    await recordError(db, new Error("Failure"), {
      body: "x".repeat(3000),
      nested: {
        url: "postgresql://test:mock@localhost/db",
        token: "bot123456:mock_token",
      },
    });
    const row = await db.telegramBotError.findFirstOrThrow();
    expect(typeof row.context).toBe("object");
    expect(JSON.stringify(row.context)).not.toContain("mock");
    expect(JSON.stringify(row.context)).toContain("[TOKEN]");
  });
  it("all new menus, translation cards and legacy IDs fit Telegram callback limits", async () => {
    await seedCatalog(db);
    const h = harness();
    for (const section of [
      "tariffs",
      "funnel",
      "bonuses",
      "languages",
      "status",
    ])
      await h.click("a:menu:" + section);
    const c = await db.course.findFirstOrThrow({
      where: { slug: "classical-body-face" },
    });
    const tariff = await db.courseTariff.findFirstOrThrow({
      where: { courseId: c.id },
    });
    await h.click("a:card:courses:" + c.id);
    await h.click("a:ctar:" + c.id + ":0");
    await h.click("a:card:tariffs:" + tariff.id);
    await h.click("a:tr:ct:" + c.id + ":KZ");
    await h.click("a:tr:tt:" + tariff.id + ":KZ");
    await db.courseTranslation.create({
      data: {
        id: "ct-" + "x".repeat(25),
        courseId: course.id,
        language: "RU",
        title: "Legacy",
      },
    });
    await h.click("a:tr:ct:" + course.id + ":RU");
    expect(await db.telegramBotError.count()).toBe(0);
    for (const call of h.calls) {
      const markup = call.payload.reply_markup as
        { inline_keyboard?: { callback_data?: string }[][] } | undefined;
      for (const row of markup?.inline_keyboard ?? [])
        for (const b of row)
          if (b.callback_data)
            expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
    }
  });
});
