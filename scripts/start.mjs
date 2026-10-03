import { spawn } from "node:child_process";
const web = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "-H",
    "0.0.0.0",
    "-p",
    process.env.PORT || "3000",
  ],
  { stdio: "inherit" },
);
const worker = spawn(process.execPath, ["dist/worker.js"], {
  stdio: "inherit",
});
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  web.kill("SIGTERM");
  worker.kill("SIGTERM");
  setTimeout(() => {
    web.kill("SIGKILL");
    worker.kill("SIGKILL");
    process.exit(code);
  }, 5000).unref();
}
web.on("exit", (code) => stop(code || 1));
worker.on("exit", (code) => stop(code || 1));
web.on("error", () => stop(1));
worker.on("error", () => stop(1));
process.on("SIGTERM", () => stop());
process.on("SIGINT", () => stop());
