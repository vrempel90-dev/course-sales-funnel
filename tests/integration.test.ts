import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import {
  PrismaClient,
  Course,
  AdminUser,
  CourseCategory,
} from "@prisma/client";
import type { Update } from "grammy/types";
import type { Transformer } from "grammy";
import { WorkflowService } from "../src/services/workflow";
import { PaymentService } from "../src/services/payments";
import { ManagerService } from "../src/services/manager";
import { AccessService } from "../src/services/access";
import { JobService } from "../src/services/jobs";
import { TelegramGateway } from "../src/bot/gateway";
import { mutate } from "../src/admin/mutations";
import { createBot } from "../src/bot";
import { dashboard } from "../src/admin/data";
const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
suite("PostgreSQL services and Telegram flow", () => {
  const db = new PrismaClient({
    ...(url ? { datasources: { db: { url } } } : {}),
  });
  const workflow = new WorkflowService(db);
  const payments = new PaymentService(db);
  const manager = new ManagerService(db);
  let category: CourseCategory;
  let course: Course;
  let admin: AdminUser;
  let staff: AdminUser;
  let sequence = 100000;
  const telegram: TelegramGateway = {
    send: vi.fn(async () => {}),
    receipt: vi.fn(async () => {}),
    createInvite: vi.fn(async () => `https://t.me/+test-${sequence++}`),
    revokeInvite: vi.fn(async () => {}),
  };
  const access = new AccessService(db, telegram);
  const jobs = new JobService(db, telegram, access);
  async function user() {
    const id = sequence++;
    return workflow.user({
      id,
      first_name: `Test ${id}`,
      username: `user${id}`,
    });
  }
  async function checkout() {
    const u = await user();
    await workflow.course(u.id, course.id, "select");
    return { u, payment: await payments.create(u.id, course.id, "KZ") };
  }
  async function receipt() {
    const result = await checkout();
    await payments.waitReceipt(result.u.id, result.payment.id);
    await payments.receipt(result.u.id, `receipt-${sequence}`, "document");
    return result;
  }
  beforeAll(async () => {
    if (!url?.includes("/course_funnel_test"))
      throw new Error("Integration tests require their isolated test database");
    category = await db.courseCategory.create({
      data: { slug: "test-body", title: "Test body" },
    });
    course = await db.course.create({
      data: {
        slug: "test-course",
        title: "Test course",
        categoryId: category.id,
        shortDescription: "Short",
        fullDescription: "Full",
        program: "Theory and practice",
        duration: "4 weeks",
        status: "ACTIVE",
        priceKZT: 50000,
        priceRUB: 10000,
        telegramChannelId: "-1001234567890",
        demoVideoUrl: "https://example.test/demo",
      },
    });
    admin = await db.adminUser.create({
      data: {
        name: "Admin",
        email: "admin@example.test",
        passwordHash: "not-used",
        role: "ADMIN",
        telegramId: 999999n,
      },
    });
    staff = await db.adminUser.create({
      data: { name: "Manager", passwordHash: "not-used", role: "MANAGER" },
    });
    await db.setting.update({
      where: { key: "payment.KZ" },
      data: {
        value: {
          enabled: true,
          title: "Test bank",
          instruction: "TEST ONLY",
          requisites: "TEST REQUISITES",
        },
      },
    });
    await db.setting.update({
      where: { key: "payment.RU" },
      data: {
        value: {
          enabled: true,
          title: "Test bank RU",
          instruction: "TEST ONLY",
          requisites: "TEST REQUISITES",
        },
      },
    });
    await db.setting.update({
      where: { key: "bot" },
      data: { value: { adminChatId: "999999", helpText: "Help" } },
    });
    await db.recommendationRule.create({
      data: {
        courseId: course.id,
        categoryId: category.id,
        experienceLevel: "BEGINNER",
        priority: 100,
      },
    });
  });
  afterAll(() => db.$disconnect());
  it("seed is idempotent and retains drafts", async () => {
    expect(
      await db.adminUser.count({ where: { email: "seed@example.test" } }),
    ).toBe(1);
    expect(await db.course.count({ where: { status: "DRAFT" } })).toBe(5);
  });
  it("creates one CRM user per Telegram ID", async () => {
    const u = await user();
    const same = await workflow.user({
      id: Number(u.telegramId),
      first_name: "Updated",
    });
    expect(same.id).toBe(u.id);
    expect(same.firstName).toBe("Updated");
  });
  it("persists questionnaire steps across service instances, rejects stale callbacks, and recommends database courses", async () => {
    const u = await user();
    await workflow.start(u.id);
    const started = await workflow.questionnaire(u.id);
    const after = await workflow.answer(
      u.id,
      started.questionnaireVersion,
      "experience",
      "BEGINNER",
    );
    expect(after.conversationStep).toBe("CATEGORY");
    const fresh = new WorkflowService(db);
    const resumed = await fresh.questionnaire(u.id);
    expect(resumed.questionnaireVersion).toBe(started.questionnaireVersion);
    await fresh.answer(
      u.id,
      started.questionnaireVersion,
      "experience",
      "PROFESSIONAL",
    );
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: u.id } }))
        .experienceLevel,
    ).toBe("BEGINNER");
    await fresh.answer(
      u.id,
      started.questionnaireVersion,
      "category",
      category.id,
    );
    await fresh.answer(
      u.id,
      started.questionnaireVersion,
      "goal",
      "NEW_PROFESSION",
    );
    expect(
      await db.questionnaireAnswer.count({ where: { userId: u.id } }),
    ).toBe(3);
    expect(
      await db.courseRecommendation.count({
        where: { userId: u.id, courseId: course.id },
      }),
    ).toBe(1);
    expect(
      await db.funnelEvent.count({
        where: { userId: u.id, type: "questionnaire_completed" },
      }),
    ).toBe(1);
  });
  it("allows going back while invalidating old questionnaire buttons", async () => {
    const u = await user();
    const q = await workflow.questionnaire(u.id);
    await workflow.answer(
      u.id,
      q.questionnaireVersion,
      "experience",
      "BEGINNER",
    );
    await workflow.answer(
      u.id,
      q.questionnaireVersion,
      "category",
      category.id,
    );
    const back = await workflow.back(u.id, q.questionnaireVersion);
    expect(back.conversationStep).toBe("CATEGORY");
    expect(back.questionnaireVersion).toBe(q.questionnaireVersion + 1);
    const stale = await workflow.answer(
      u.id,
      q.questionnaireVersion,
      "goal",
      "PERSONAL",
    );
    expect(stale.learningGoal).toBeNull();
    await workflow.answer(
      u.id,
      back.questionnaireVersion,
      "category",
      category.id,
    );
    await workflow.answer(u.id, back.questionnaireVersion, "goal", "PERSONAL");
    expect(
      await db.questionnaireAnswer.count({
        where: {
          userId: u.id,
          questionnaireVersion: back.questionnaireVersion,
        },
      }),
    ).toBe(3);
  });
  it("records course selection and demo", async () => {
    const u = await user();
    await workflow.course(u.id, course.id, "demo");
    await workflow.course(u.id, course.id, "select");
    expect(
      (await db.user.findUniqueOrThrow({ where: { id: u.id } }))
        .selectedCourseId,
    ).toBe(course.id);
  });
  it("snapshots KZT prices and protects concurrent payment creation", async () => {
    const u = await user();
    await workflow.course(u.id, course.id, "select");
    const result = await Promise.all([
      payments.create(u.id, course.id, "KZ"),
      payments.create(u.id, course.id, "KZ"),
    ]);
    expect(result[0].id).toBe(result[1].id);
    expect(result[0].amount.toString()).toBe("50000");
    expect(result[0].currency).toBe("KZT");
  });
  it("selects RUB prices for Russia", async () => {
    const u = await user();
    await workflow.course(u.id, course.id, "select");
    const p = await payments.create(u.id, course.id, "RU");
    expect(p.amount.toString()).toBe("10000");
    expect(p.currency).toBe("RUB");
  });
  it("switches country by cancelling the old pending payment, keeping only one active payment", async () => {
    const { u, payment } = await checkout();
    await workflow.course(u.id, course.id, "select");
    const next = await payments.create(u.id, course.id, "RU");
    expect(next.id).not.toBe(payment.id);
    expect(
      (await db.payment.findUniqueOrThrow({ where: { id: payment.id } }))
        .status,
    ).toBe("CANCELLED");
    expect(
      await db.payment.count({
        where: { userId: u.id, activeKey: { not: null } },
      }),
    ).toBe(1);
  });
  it("blocks stale receipt approval after resubmission", async () => {
    const { u, payment } = await receipt();
    await payments.review(payment.id, admin.id, false, "Retry", 1);
    await payments.waitReceipt(u.id, payment.id);
    await payments.receipt(u.id, "new-receipt", "photo");
    await expect(
      payments.review(payment.id, admin.id, true, undefined, 1),
    ).rejects.toThrow("Чек изменился");
    expect(
      (await db.payment.findUniqueOrThrow({ where: { id: payment.id } }))
        .status,
    ).toBe("PENDING_REVIEW");
  });
  it("cancels payment reminders after receipt submission", async () => {
    await db.setting.update({
      where: { key: "reminders" },
      data: { value: { enabled: true, demoHours: 1, paymentHours: 1 } },
    });
    const { u, payment } = await receipt();
    expect(
      (
        await db.reminder.findFirstOrThrow({
          where: { userId: u.id, contextId: payment.id },
        })
      ).status,
    ).toBe("CANCELLED");
  });
  it("requires the receipt step, stores file_id, and sends an admin receipt job", async () => {
    const { u, payment } = await checkout();
    await expect(payments.receipt(u.id, "file", "photo")).rejects.toThrow();
    await payments.waitReceipt(u.id, payment.id);
    const p = await payments.receipt(u.id, "file", "photo");
    expect(p.status).toBe("PENDING_REVIEW");
    expect(p.receiptFileId).toBe("file");
    expect(
      await db.outboxJob.count({
        where: { entityId: p.id, type: "PAYMENT_REVIEW" },
      }),
    ).toBe(1);
    await expect(payments.receipt(u.id, "another", "photo")).rejects.toThrow();
  });
  it("disabling reminders cancels queued deliveries", async () => {
    const u = await user();
    await workflow.course(u.id, course.id, "demo");
    const reminder = await db.reminder.findFirstOrThrow({
      where: { userId: u.id, type: "DEMO" },
    });
    await db.setting.update({
      where: { key: "reminders" },
      data: { value: { enabled: false, demoHours: 1, paymentHours: 1 } },
    });
    const calls = vi.mocked(telegram.send).mock.calls.length;
    await jobs.deliver({ type: "REMINDER", entityId: reminder.id });
    expect(
      (await db.reminder.findUniqueOrThrow({ where: { id: reminder.id } }))
        .status,
    ).toBe("CANCELLED");
    expect(vi.mocked(telegram.send).mock.calls.length).toBe(calls);
    await db.setting.update({
      where: { key: "reminders" },
      data: { value: { enabled: true, demoHours: 1, paymentHours: 1 } },
    });
  });
  it("blocks approval without a receipt and blocks managers", async () => {
    const { payment } = await checkout();
    await expect(payments.review(payment.id, admin.id, true)).rejects.toThrow();
    const { payment: p } = await receipt();
    await expect(payments.review(p.id, staff.id, true)).rejects.toThrow(
      "Недостаточно прав",
    );
  });
  it("atomically approves concurrent clicks and creates only one enrollment, audit and access job", async () => {
    const { payment } = await receipt();
    const result = await Promise.all([
      payments.review(payment.id, admin.id, true),
      payments.review(payment.id, admin.id, true),
    ]);
    expect(result[0]?.id).toBe(result[1]?.id);
    expect(
      await db.enrollment.count({ where: { paymentId: payment.id } }),
    ).toBe(1);
    expect(
      await db.auditLog.count({
        where: { entityId: payment.id, action: "PAYMENT_APPROVED" },
      }),
    ).toBe(1);
    expect(
      await db.outboxJob.count({
        where: { entityId: result[0]!.id, type: "ACCESS" },
      }),
    ).toBe(1);
  });
  it("rejects and permits receipt resubmission, preserving review history", async () => {
    const { u, payment } = await receipt();
    await payments.review(payment.id, admin.id, false, "Bad receipt");
    await payments.waitReceipt(u.id, payment.id);
    const next = await payments.receipt(u.id, "replacement", "document");
    expect(next.receiptRevision).toBe(2);
    expect(next.status).toBe("PENDING_REVIEW");
    expect(await db.auditLog.count({ where: { entityId: payment.id } })).toBe(
      1,
    );
  });
  it("creates one invite under concurrent grants and persists before notifying", async () => {
    const { payment } = await receipt();
    const e = await payments.review(payment.id, admin.id, true);
    const before = vi.mocked(telegram.createInvite).mock.calls.length;
    await Promise.all([access.grant(e!.id), access.grant(e!.id)]);
    expect(vi.mocked(telegram.createInvite).mock.calls.length - before).toBe(1);
    const stored = await db.enrollment.findUniqueOrThrow({
      where: { id: e!.id },
    });
    expect(stored.accessStatus).toBe("GRANTED");
    expect(stored.telegramInviteLink).toContain("https://t.me/+test-");
    expect(
      await db.outboxJob.count({
        where: { entityId: e!.id, type: "ACCESS_NOTIFY" },
      }),
    ).toBe(1);
    await access.grant(e!.id);
    expect(vi.mocked(telegram.createInvite).mock.calls.length - before).toBe(1);
  });
  it("does not roll back PAID on Telegram access errors", async () => {
    const { payment } = await receipt();
    const e = await payments.review(payment.id, admin.id, true);
    vi.mocked(telegram.createInvite).mockRejectedValueOnce(
      new Error("Telegram 400: not administrator"),
    );
    const failed = await access.grant(e!.id);
    expect(failed.accessStatus).toBe("FAILED");
    expect(
      (await db.payment.findUniqueOrThrow({ where: { id: payment.id } }))
        .status,
    ).toBe("PAID");
    await access.retry(e!.id, admin.id);
    expect((await access.grant(e!.id)).accessStatus).toBe("GRANTED");
  });
  it("requires reconciliation for an ambiguous timeout", async () => {
    const { payment } = await receipt();
    const e = await payments.review(payment.id, admin.id, true);
    vi.mocked(telegram.createInvite).mockRejectedValueOnce(
      new Error("Request timed out"),
    );
    expect((await access.grant(e!.id)).accessStatus).toBe("UNCERTAIN");
    await expect(access.retry(e!.id, admin.id)).rejects.toThrow(
      "Проверьте ссылки",
    );
    await access.retry(e!.id, admin.id, true);
  });
  it("does not recreate invite when access notification fails", async () => {
    const { payment } = await receipt();
    const e = await payments.review(payment.id, admin.id, true);
    await access.grant(e!.id);
    const before = vi.mocked(telegram.createInvite).mock.calls.length;
    vi.mocked(telegram.send).mockRejectedValueOnce(new Error("Offline"));
    await expect(
      jobs.deliver({ type: "ACCESS_NOTIFY", entityId: e!.id }),
    ).rejects.toThrow();
    await jobs.deliver({ type: "ACCESS_NOTIFY", entityId: e!.id });
    expect(vi.mocked(telegram.createInvite).mock.calls.length).toBe(before);
  });
  it("creates manager requests and persists the message", async () => {
    const u = await user();
    const req = await manager.begin(u.id, course.id);
    await manager.begin(u.id, course.id);
    await manager.message(u.id, "My question");
    expect(await db.managerRequest.count({ where: { userId: u.id } })).toBe(1);
    expect(
      (await db.managerRequest.findUniqueOrThrow({ where: { id: req!.id } }))
        .message,
    ).toBe("My question");
  });
  it("rejects other people's phone contacts", async () => {
    const u = await user();
    await expect(
      workflow.contact(u.id, Number(u.telegramId), {
        user_id: 123,
        phone_number: "+70000000000",
      }),
    ).rejects.toThrow();
  });
  it("enforces role permissions at mutations and hides role escalation", async () => {
    await expect(mutate(db, "settings", { data: {} }, staff)).rejects.toThrow(
      "Недостаточно прав",
    );
    await expect(mutate(db, "admins", { data: {} }, staff)).rejects.toThrow(
      "Недостаточно прав",
    );
  });
  it("reports revenue by currency and counts unique funnel clients", async () => {
    const result = await dashboard(db);
    expect(result.revenue.map((row) => row.currency)).toContain("KZT");
    expect(
      result.funnel.find((row) => row.type === "payment_confirmed")?.count,
    ).toBeGreaterThan(0);
  });
  it("runs the real grammY handlers with mocked Telegram API", async () => {
    const bot = createBot("123456:test-token", db);
    const sent: string[] = [];
    const fakeApi = async (
      _prev: unknown,
      method: string,
      payload: unknown,
    ) => {
      if (method === "getMe")
        return {
          ok: true,
          result: {
            id: 123456,
            is_bot: true,
            first_name: "Bot",
            username: "test_bot",
          },
        };
      if (method === "sendMessage")
        sent.push(String((payload as { text: string }).text));
      return {
        ok: true,
        result:
          method === "answerCallbackQuery"
            ? true
            : {
                message_id: sequence++,
                date: 1,
                chat: { id: sequence, type: "private" },
                text: "Mock",
              },
      };
    };
    bot.api.config.use(fakeApi as unknown as Transformer);
    await bot.init();
    const id = sequence++;
    const from = { id, is_bot: false, first_name: "Bot test" };
    const chat = { id, type: "private" as const, first_name: "Bot test" };
    await bot.handleUpdate({
      update_id: sequence++,
      message: {
        message_id: sequence++,
        date: 1,
        from,
        chat,
        text: "/start",
        entities: [{ offset: 0, length: 6, type: "bot_command" }],
      },
    });
    const callback = async (data: string) =>
      bot.handleUpdate({
        update_id: sequence++,
        callback_query: {
          id: String(sequence++),
          from,
          chat_instance: "test",
          data,
          message: { message_id: sequence++, date: 1, chat, text: "Question" },
        },
      } as Update);
    await callback("questionnaire");
    const u = await db.user.findUniqueOrThrow({
      where: { telegramId: BigInt(id) },
    });
    await callback(`q:${u.questionnaireVersion}:experience:BEGINNER`);
    await callback(`q:${u.questionnaireVersion}:category:${category.id}`);
    await callback(`q:${u.questionnaireVersion}:goal:PERSONAL`);
    await callback(`buy:${course.id}`);
    await callback(`country:KZ:${course.id}`);
    const p = await db.payment.findFirstOrThrow({ where: { userId: u.id } });
    await callback(`receipt:${p.id}`);
    await bot.handleUpdate({
      update_id: sequence++,
      message: {
        message_id: sequence++,
        date: 1,
        from,
        chat,
        document: {
          file_id: "mock-pdf",
          file_unique_id: "unique",
          mime_type: "application/pdf",
          file_size: 100,
        },
      },
    });
    expect(
      (await db.payment.findUniqueOrThrow({ where: { id: p.id } })).status,
    ).toBe("PENDING_REVIEW");
    expect(sent.some((text) => text.includes("Чек получен"))).toBe(true);
    await callback("obsolete-action");
    expect(sent.at(-1)).toContain("Кнопка устарела");
  });
});
