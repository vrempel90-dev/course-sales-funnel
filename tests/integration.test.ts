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
import { bootstrapOwner, requireAdmin } from "../src/services/auth";
import { AdminService } from "../src/services/admin";
import { PaymentService } from "../src/services/payments";
import { AccessService } from "../src/services/access";
import { Conversations, payload } from "../src/services/conversations";
import { AdminRepository } from "../src/repositories/admin";
import { GrammyGateway, TelegramGateway } from "../src/bot/gateway";
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
    expect(await db.courseCategory.count()).toBe(5);
    expect(await db.course.count()).toBe(5);
    expect(await db.course.count({ where: { status: "DRAFT" } })).toBe(5);
    expect(await db.adminUser.count({ where: { role: "OWNER" } })).toBe(1);
  });
  beforeEach(async () => {
    await db.$executeRawUnsafe(
      'TRUNCATE "User","AdminUser","CourseCategory","Setting","PaymentMethodSetting","TelegramBotError","TelegramUpdate","WorkerLease" CASCADE',
    );
    owner = (await bootstrapOwner(db, "1001"))!;
    admin = await db.adminUser.create({
      data: { name: "Admin", telegramId: 1002n, role: "ADMIN" },
    });
    manager = await db.adminUser.create({
      data: { name: "Manager", telegramId: 1003n, role: "MANAGER" },
    });
    category = await db.courseCategory.create({
      data: { slug: "test", title: "Массаж" },
    });
    course = await db.course.create({
      data: {
        slug: "test",
        title: "Курс",
        shortDescription: "Кратко",
        fullDescription: "Полное описание",
        program: "Программа",
        duration: "Месяц",
        priceKZT: 100,
        priceRUB: 20,
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
    let state = await flows.begin(admin.id, "course", c.id, "priceKZT");
    state = await flows.input(admin.id, state.nonce, "26000.50");
    await flows.commit(admin.id, state.nonce);
    state = await flows.begin(admin.id, "course", c.id, "status");
    state = await flows.input(admin.id, state.nonce, "ARCHIVED");
    await flows.commit(admin.id, state.nonce);
    expect(await db.course.findUnique({ where: { id: c.id } })).toMatchObject({
      status: "ARCHIVED",
      priceKZT: expect.objectContaining({}),
    });
    expect(
      (
        await db.course.findUniqueOrThrow({ where: { id: c.id } })
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
  it("course wizard has 12 steps and allows preview field correction", async () => {
    let s = await flows.begin(admin.id, "course");
    const values = [
      "Course",
      "Short",
      "Full",
      category.id,
      "Program",
      "Month",
      "100",
      "20",
      { imageFileId: "photo_id", imageUrl: null },
      { demoFileId: "video_id", demoVideoUrl: null },
      "-1001234567890",
      "ACTIVE",
    ];
    expect(payload(s).keys).toHaveLength(12);
    for (const value of values) s = await flows.input(admin.id, s.nonce, value);
    s = await flows.editPreview(admin.id, s.nonce, "priceKZT");
    s = await flows.input(admin.id, s.nonce, "150");
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
    await h.text("Description");
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
});
