import EmbeddedPostgres from "embedded-postgres";
import { spawn } from "node:child_process";
import { randomUUID, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { createServer } from "node:net";
async function command(script: string, args: string[], env: NodeJS.ProcessEnv) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
      stdio: "inherit",
      env,
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Command exited ${code}`)),
    );
  });
}
async function main() {
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
    databaseDir: resolve("work", `pg-${randomUUID()}`),
    user: "postgres",
    password: randomBytes(24).toString("hex"),
    port,
    persistent: true,
    onLog: () => {},
    onError: (message) => console.error(message),
  });
  try {
    await pg.initialise();
    await pg.start();
    await pg.createDatabase("course_funnel_test");
    // The embedded cluster is dedicated to this run. Never touch DATABASE_URL from the user's environment.
    const client = pg.getPgClient();
    const config = client.connectionParameters;
    const url = `postgresql://${encodeURIComponent(config.user)}:${encodeURIComponent(config.password || "")}@127.0.0.1:${port}/course_funnel_test?schema=public`;
    const env = {
      ...process.env,
      DATABASE_URL: url,
      TEST_DATABASE_URL: url,
      SESSION_SECRET: randomBytes(32).toString("hex"),
      ADMIN_INITIAL_EMAIL: "seed@example.test",
      ADMIN_INITIAL_PASSWORD: randomBytes(16).toString("hex"),
      APP_URL: "http://localhost:3000",
    };
    console.info(
      "Running migrations, seed twice, and service/bot tests against isolated PostgreSQL.",
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
    else await command("node_modules/vitest/vitest.mjs", ["run"], env);
  } finally {
    await pg.stop();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
