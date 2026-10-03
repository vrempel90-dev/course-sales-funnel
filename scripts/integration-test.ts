import { spawn } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { createServer } from "node:net";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
async function command(script: string, args: string[], env: NodeJS.ProcessEnv) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      stdio: "inherit",
      env,
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error("Command exited " + code)),
    );
  });
}
async function main() {
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const port = await new Promise<number>((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port =
        typeof address === "object" && address ? address.port : 55432;
      server.close(() => resolve(port));
    });
  });
  const pg = new EmbeddedPostgres({
    databaseDir: resolve("work", "pg-" + randomUUID()),
    user: "postgres",
    password: randomBytes(24).toString("hex"),
    port,
    persistent: true,
    initdbFlags: ["--encoding=UTF8"],
    onLog: () => {},
    onError: (message) => console.error(message),
  });
  try {
    await pg.initialise();
    await pg.start();
    await pg.createDatabase("course_funnel_legacy");
    const legacy = pg.getPgClient("course_funnel_legacy");
    await legacy.connect();
    try {
      await legacy.query(
        await readFile(
          "prisma/migrations/20261003110000_initial/migration.sql",
          "utf8",
        ),
      );
      await legacy.query(`INSERT INTO "AdminUser" (id,name,"passwordHash",role,"updatedAt") VALUES ('a','Legacy','hash','ADMIN',CURRENT_TIMESTAMP);
        INSERT INTO "CourseCategory" (id,slug,title,"updatedAt") VALUES ('cat','legacy','Legacy',CURRENT_TIMESTAMP);
        INSERT INTO "Course" (id,slug,title,"shortDescription","fullDescription",program,duration,"categoryId","priceKZT","priceRUB","updatedAt") VALUES ('c','legacy','Legacy','Short','Full','Program','Month','cat',100,20,CURRENT_TIMESTAMP);
        INSERT INTO "User" (id,"telegramId","firstName","updatedAt") VALUES ('u',777,'Legacy',CURRENT_TIMESTAMP);
        INSERT INTO "Payment" (id,"userId","courseId",amount,currency,country,"paymentMethod",instruction,requisites,status,"reviewedBy","receiptFileType") VALUES ('p','u','c',100,'KZT','KZ','Kaspi','','','PAID','a','photo');
        INSERT INTO "Enrollment" (id,"userId","courseId","paymentId","updatedAt") VALUES ('e','u','c','p',CURRENT_TIMESTAMP);
        INSERT INTO "TelegramBotError" (id,context,message) VALUES ('err','legacy','Legacy error');
        INSERT INTO "Setting" (key,value,"updatedAt") VALUES ('payment.KZ','{"enabled":true,"title":"Existing","instruction":"Instruction","requisites":"Existing value"}',CURRENT_TIMESTAMP);`);
      await legacy.query(
        await readFile(
          "prisma/migrations/20261003180000_telegram_admin/migration.sql",
          "utf8",
        ),
      );
      assert.equal(
        (
          await legacy.query(
            'SELECT "accessStatus" FROM "Enrollment" WHERE id=\'e\'',
          )
        ).rows[0].accessStatus,
        "PENDING",
      );
      assert.equal(
        (
          await legacy.query(
            "SELECT requisites FROM \"PaymentMethodSetting\" WHERE country='KZ'",
          )
        ).rows[0].requisites,
        "Existing value",
      );
      assert.equal(
        (
          await legacy.query(
            'SELECT "receiptFileType" FROM "Payment" WHERE id=\'p\'',
          )
        ).rows[0].receiptFileType,
        "photo",
      );
      assert.deepEqual(
        (
          await legacy.query(
            "SELECT context FROM \"TelegramBotError\" WHERE id='err'",
          )
        ).rows[0].context,
        { legacyContext: "legacy" },
      );
      assert.equal(
        (await legacy.query('SELECT count(*) FROM "User"')).rows[0].count,
        "1",
      );
      console.info("Legacy migration preservation: 5 assertions passed.");
    } finally {
      await legacy.end();
    }
    await pg.createDatabase("course_funnel_test");
    const client = pg.getPgClient(),
      config = client.connectionParameters;
    const url =
      "postgresql://" +
      encodeURIComponent(config.user) +
      ":" +
      encodeURIComponent(config.password || "") +
      "@127.0.0.1:" +
      port +
      "/course_funnel_test?schema=public";
    const env = {
      ...process.env,
      DATABASE_URL: url,
      TEST_DATABASE_URL: url,
      OWNER_TELEGRAM_ID: "1001",
      TELEGRAM_BOT_TOKEN: "",
      NODE_ENV: "test",
    };
    console.info(
      "Isolated PostgreSQL: migrations, idempotent seed, administrative tests.",
    );
    await command(
      "node_modules/prisma/build/index.js",
      ["migrate", "deploy"],
      env,
    );
    await command("node_modules/tsx/dist/cli.mjs", ["prisma/seed.ts"], env);
    await command("node_modules/tsx/dist/cli.mjs", ["prisma/seed.ts"], env);
    if (process.argv.includes("--http"))
      await command(
        "node_modules/tsx/dist/cli.mjs",
        ["scripts/http-smoke.ts"],
        env,
      );
    else
      await command(
        "node_modules/vitest/vitest.mjs",
        ["run", ...process.argv.slice(2)],
        env,
      );
  } finally {
    await pg.stop();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
