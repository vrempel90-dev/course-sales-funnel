import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { WorkflowService } from "../src/services/workflow";
import { PaymentService } from "../src/services/payments";
async function main() {
  const port = await new Promise<number>((resolve) => {
    const s = createServer();
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      const p = typeof a === "object" && a ? a.port : 3001;
      s.close(() => resolve(p));
    });
  });
  const origin = `http://localhost:${port}`;
  const secret = randomBytes(32).toString("hex");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    APP_URL: origin,
    TELEGRAM_BOT_TOKEN: "",
    TELEGRAM_MODE: "webhook",
    TELEGRAM_WEBHOOK_SECRET: secret,
    NODE_ENV: "production",
  };
  const server = spawn(
    process.execPath,
    ["node_modules/next/dist/bin/next", "start", "-p", String(port)],
    { env, stdio: "inherit" },
  );
  const db = new PrismaClient();
  let checks = 0;
  try {
    for (let tries = 0; ; tries++) {
      try {
        if ((await fetch(`${origin}/api/health`)).ok) break;
      } catch {}
      if (tries > 60) throw new Error("Production server did not start");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    const request = (
      path: string,
      method = "GET",
      input?: unknown,
      cookie?: string,
      source = origin,
    ) =>
      fetch(`${origin}${path}`, {
        method,
        headers: {
          ...(input ? { "Content-Type": "application/json" } : {}),
          ...(method !== "GET" ? { Origin: source } : {}),
          ...(cookie ? { Cookie: cookie } : {}),
        },
        ...(input ? { body: JSON.stringify(input) } : {}),
      });
    const expectStatus = async (response: Response, expected: number) => {
      assert.equal(response.status, expected, await response.clone().text());
      checks++;
      return response;
    };
    await expectStatus(await request("/api/admin/clients"), 401);
    const login = await expectStatus(
      await request("/api/auth/login", "POST", {
        email: process.env.ADMIN_INITIAL_EMAIL,
        password: process.env.ADMIN_INITIAL_PASSWORD,
      }),
      200,
    );
    const setCookie = login.headers.get("set-cookie")!;
    assert.ok(
      setCookie.includes("HttpOnly") &&
        setCookie.includes("Secure") &&
        setCookie.includes("SameSite=lax"),
    );
    checks++;
    const cookie = setCookie.split(";")[0];
    for (const resource of [
      "dashboard",
      "clients",
      "courses",
      "categories",
      "recommendations",
      "payments",
      "access",
      "requests",
      "funnel",
      "settings",
      "admins",
      "audit",
      "jobs",
      "lookups",
    ])
      await expectStatus(
        await request(`/api/admin/${resource}`, "GET", undefined, cookie),
        200,
      );
    await expectStatus(
      await request(
        "/api/admin/categories",
        "POST",
        { data: {} },
        cookie,
        "https://evil.example",
      ),
      403,
    );
    const categoryResponse = await expectStatus(
      await request(
        "/api/admin/categories",
        "POST",
        {
          data: {
            title: "HTTP Category",
            slug: "http-category",
            sortOrder: 20,
            active: true,
          },
        },
        cookie,
      ),
      200,
    );
    const category = await categoryResponse.json();
    const courseData = {
      title: "HTTP Course",
      slug: "http-course",
      shortDescription: "Short",
      fullDescription: "Full",
      program: "Program",
      duration: "1 week",
      categoryId: category.id,
      status: "ACTIVE",
      priceKZT: 1000,
      priceRUB: 200,
      telegramChannelId: "-1001234567890",
    };
    const course = await (
      await expectStatus(
        await request(
          "/api/admin/courses",
          "POST",
          { data: courseData },
          cookie,
        ),
        200,
      )
    ).json();
    await expectStatus(
      await request(
        "/api/admin/courses",
        "POST",
        { id: course.id, data: { ...courseData, duration: "2 weeks" } },
        cookie,
      ),
      200,
    );
    const rule = await (
      await expectStatus(
        await request(
          "/api/admin/recommendations",
          "POST",
          {
            data: {
              courseId: course.id,
              categoryId: category.id,
              experienceLevel: null,
              learningGoal: null,
              matchMode: "ALL",
              priority: 99,
              active: true,
            },
          },
          cookie,
        ),
        200,
      )
    ).json();
    await expectStatus(
      await request(
        "/api/admin/recommendations",
        "DELETE",
        { id: rule.id },
        cookie,
      ),
      200,
    );
    await expectStatus(
      await request(
        "/api/admin/settings",
        "POST",
        {
          data: {
            key: "payment.KZ",
            value: {
              enabled: true,
              title: "Bank",
              instruction: "TEST",
              requisites: "TEST",
            },
          },
        },
        cookie,
      ),
      200,
    );
    const managerPassword = randomBytes(16).toString("hex");
    await expectStatus(
      await request(
        "/api/admin/admins",
        "POST",
        {
          data: {
            name: "HTTP Manager",
            email: "manager@example.test",
            telegramId: null,
            password: managerPassword,
            role: "MANAGER",
            active: true,
          },
        },
        cookie,
      ),
      200,
    );
    const managerLogin = await expectStatus(
      await request("/api/auth/login", "POST", {
        email: "manager@example.test",
        password: managerPassword,
      }),
      200,
    );
    const managerCookie = managerLogin.headers.get("set-cookie")!.split(";")[0];
    await expectStatus(
      await request("/api/admin/payments", "GET", undefined, managerCookie),
      200,
    );
    await expectStatus(
      await request("/api/admin/admins", "GET", undefined, managerCookie),
      403,
    );
    await expectStatus(
      await request("/api/admin/settings", "POST", { data: {} }, managerCookie),
      403,
    );
    await expectStatus(
      await request(
        "/api/admin/actions",
        "POST",
        { action: "approve", id: "x", revision: 1 },
        managerCookie,
      ),
      403,
    );
    const workflow = new WorkflowService(db);
    const payments = new PaymentService(db);
    const u = await workflow.user({ id: 888888, first_name: "HTTP Buyer" });
    await workflow.course(u.id, course.id, "select");
    const payment = await payments.create(u.id, course.id, "KZ");
    await payments.waitReceipt(u.id, payment.id);
    await payments.receipt(u.id, "http-test-file", "document");
    await expectStatus(
      await request(
        `/api/admin/payments?id=${payment.id}`,
        "GET",
        undefined,
        cookie,
      ),
      200,
    );
    await expectStatus(
      await request(
        "/api/admin/actions",
        "POST",
        { action: "approve", id: payment.id, revision: 1 },
        cookie,
      ),
      200,
    );
    await expectStatus(
      await request(
        "/api/admin/actions",
        "POST",
        { action: "approve", id: payment.id, revision: 1 },
        cookie,
      ),
      200,
    );
    assert.equal(
      await db.enrollment.count({ where: { paymentId: payment.id } }),
      1,
    );
    checks++;
    await expectStatus(
      await request(
        `/api/admin/receipts/${payment.id}`,
        "GET",
        undefined,
        cookie,
      ),
      503,
    );
    await expectStatus(
      await request(`/api/admin/clients?id=${u.id}`, "GET", undefined, cookie),
      200,
    );
    await expectStatus(
      await request(
        "/api/admin/payments?status=INVALID",
        "GET",
        undefined,
        cookie,
      ),
      400,
    );
    await expectStatus(
      await request("/api/telegram/webhook", "POST", { update_id: 42 }),
      401,
    );
    const webhook = () =>
      fetch(`${origin}/api/telegram/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-telegram-bot-api-secret-token": secret,
        },
        body: JSON.stringify({ update_id: 42, message: { text: "test" } }),
      });
    await expectStatus(await webhook(), 200);
    await expectStatus(await webhook(), 200);
    assert.equal(await db.telegramUpdate.count({ where: { id: 42n } }), 1);
    checks++;
    const admins = await (
      await request("/api/admin/admins", "GET", undefined, cookie)
    ).text();
    assert.ok(!admins.includes("passwordHash"));
    checks++;
    await expectStatus(
      await request("/api/auth/logout", "POST", {}, cookie),
      200,
    );
    await expectStatus(
      await request("/api/admin/clients", "GET", undefined, cookie),
      401,
    );
    console.info(
      `Production HTTP checks: ${checks} passed. External Telegram was not called.`,
    );
  } finally {
    server.kill("SIGTERM");
    await db.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
