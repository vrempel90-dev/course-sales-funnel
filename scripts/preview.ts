// Isolated local preview for browser verification; it never reads the user's production DATABASE_URL.
import EmbeddedPostgres from "embedded-postgres";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
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
  const password = randomBytes(16).toString("hex");
  const dbPassword = randomBytes(16).toString("hex");
  const pg = new EmbeddedPostgres({
    databaseDir: resolve("work", `preview-${randomUUID()}`),
    port: 55439,
    user: "postgres",
    password: dbPassword,
    persistent: true,
    onLog: () => {},
    onError: console.error,
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("course_funnel_preview");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: `postgresql://postgres:${dbPassword}@127.0.0.1:55439/course_funnel_preview`,
    APP_URL: "http://localhost:3000",
    SESSION_SECRET: randomBytes(32).toString("hex"),
    ADMIN_INITIAL_EMAIL: "preview@example.test",
    ADMIN_INITIAL_PASSWORD: password,
    TELEGRAM_BOT_TOKEN: "",
    NODE_ENV: "production",
  };
  await command(
    "node_modules/prisma/build/index.js",
    ["migrate", "deploy"],
    env,
  );
  await command("node_modules/tsx/dist/cli.mjs", ["prisma/seed.ts"], env);
  await mkdir("work", { recursive: true });
  await writeFile(
    "work/preview-credentials.json",
    JSON.stringify({ email: "preview@example.test", password }),
  );
  const server = spawn(process.execPath, ["scripts/start.mjs"], {
    env,
    stdio: "inherit",
  });
  console.info(
    "Isolated preview ready at http://localhost:3000; generated test credentials are in ignored work/preview-credentials.json.",
  );
  const stop = async () => {
    server.kill("SIGTERM");
    await pg.stop();
    process.exit();
  };
  process.on("SIGINT", () => void stop());
  process.on("SIGTERM", () => void stop());
  server.on("exit", () => void pg.stop());
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
