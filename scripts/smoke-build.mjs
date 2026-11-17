import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout } from "node:timers/promises";
const dir = await mkdtemp(join(tmpdir(), "water-built-"));
const child = spawn(process.execPath, ["dist/main.js"], {
  cwd: resolve("apps/api"),
  env: { ...process.env, PORT: "3367", WATER_DATA_DIR: dir },
  stdio: "pipe",
});
let log = "";
child.stdout.on("data", (b) => (log += b));
child.stderr.on("data", (b) => (log += b));
try {
  let ready = false;
  for (let i = 0; i < 150; i++) {
    try {
      const r = await fetch("http://127.0.0.1:3367/api/health");
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
    if (child.exitCode !== null) break;
    await setTimeout(100);
  }
  if (!ready) throw new Error(log);
  const login = await fetch("http://127.0.0.1:3367/api/demo/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role: "manager" }),
  });
  const { token } = await login.json();
  const response = await fetch("http://127.0.0.1:3367/api/snapshot", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const snapshot = await response.json();
  if (!response.ok || snapshot.subsystems.length !== 6)
    throw new Error("构建版快照验证失败");
  console.log("PASS: 构建后的 API 独立启动、登录、六工艺查询");
} finally {
  if (child.exitCode === null) {
    const closed = new Promise((resolve) => child.once("exit", resolve));
    child.kill("SIGTERM");
    await closed;
  }
  await rm(dir, { recursive: true, force: true });
}
