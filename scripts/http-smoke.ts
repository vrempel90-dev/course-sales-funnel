import { spawn } from "node:child_process";
import { createServer } from "node:net";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { Conversations } from "../src/services/conversations";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function main() {
  const db = new PrismaClient(),
    flows = new Conversations(db),
    children: ReturnType<typeof spawn>[] = [];
  const port = await new Promise<number>((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address(),
        port = typeof address === "object" && address ? address.port : 3050;
      server.close(() => resolve(port));
    });
  });
  const url = "http://127.0.0.1:" + port;
  async function stop(child: ReturnType<typeof spawn>) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.kill();
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
  }
  async function start() {
    const child = spawn(process.execPath, ["dist/worker.js"], {
      env: { ...process.env, PORT: String(port), TELEGRAM_BOT_TOKEN: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    let logs = "";
    child.stdout?.on("data", (chunk) => {
      logs += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      logs += chunk;
    });
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        return { child, response: await fetch(url + "/health") };
      } catch {
        await sleep(100);
      }
    }
    throw new Error("Server failed to start: " + logs);
  }
  try {
    const owner = await db.adminUser.findUniqueOrThrow({
      where: { telegramId: 1001n },
    });
    let state = await flows.begin(owner.id, "category");
    state = await flows.input(owner.id, state.nonce, "Persistent draft");
    const first = await start();
    assert.equal(first.response.status, 200);
    const body = (await first.response.json()) as Record<string, unknown>;
    assert.equal(body.status, "ok");
    assert.equal(body.database, "connected");
    assert.equal(body.tokenConfigured, false);
    assert.equal(typeof body.timestamp, "string");
    for (const path of [
      "/",
      "/admin",
      "/api/health",
      "/api/auth/login",
      "/api/admin/clients",
    ])
      assert.equal((await fetch(url + path)).status, 404);
    assert.equal(
      (await fetch(url + "/health", { method: "POST" })).status,
      404,
    );
    await stop(first.child);
    const second = await start();
    assert.equal(second.response.status, 200);
    const restored = await new Conversations(db).state(owner.id);
    assert.equal(restored.nonce, state.nonce);
    assert.equal(restored.step, 1);
    console.info(
      "HTTP smoke passed: 14 assertions; compiled worker /health, absent web routes, wizard survives process restart.",
    );
  } finally {
    for (const child of children) await stop(child);
    await db.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
