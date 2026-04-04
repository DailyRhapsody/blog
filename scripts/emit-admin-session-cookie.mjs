// 本地调试：根据 .env / .env.local 的 AUTH_SECRET 打印 admin_session 的 cookie 值（不含名称）。
// 示例（用于需管理员身份的接口）：curl -X POST http://localhost:3000/api/profile \
//   -H "Cookie: admin_session=$(node scripts/emit-admin-session-cookie.mjs)" \
//   -H "Content-Type: application/json" -d '{"name":"DailyRhapsody","signature":"","avatar":"","headerBg":""}'

import { createHmac } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

function mergeEnvFile(filename) {
  const p = path.join(process.cwd(), filename);
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq === -1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

mergeEnvFile(".env.local");
mergeEnvFile(".env");

const secret = process.env.AUTH_SECRET;
if (!secret || secret.length < 16) {
  console.error("AUTH_SECRET missing or too short in .env");
  process.exit(1);
}

/** 与 lib/auth.ts 勾选「记住密码」时一致（30 天），便于本地 curl 调试 */
const MAX_AGE_MS = 60 * 60 * 24 * 30 * 1000;
const payload = JSON.stringify({
  admin: true,
  exp: Date.now() + MAX_AGE_MS,
});
const sig = createHmac("sha256", secret).update(payload).digest("hex");
const value = Buffer.from(payload).toString("base64url") + "." + sig;
process.stdout.write(value);
