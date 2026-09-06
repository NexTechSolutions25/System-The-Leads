import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { chromium } from "@playwright/test";
import fs from "node:fs/promises";
const dbName = "nextech_leads_test_" + randomUUID().replaceAll("-", "");
const port = Number(process.env.TEST_MYSQL_PORT || 13307);
const db = await mysql.createConnection({
  host: "127.0.0.1",
  port,
  user: "root",
  password: process.env.TEST_MYSQL_PASSWORD || "",
});
await db.query(
  "CREATE DATABASE `" +
    dbName +
    "` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
);
const env = {
  ...process.env,
  DB_DRIVER: "mysql",
  MYSQL_HOST: "127.0.0.1",
  MYSQL_PORT: String(port),
  MYSQL_DATABASE: dbName,
  MYSQL_USER: "root",
  MYSQL_PASSWORD: process.env.TEST_MYSQL_PASSWORD || "",
  HOST: "127.0.0.1",
  PORT: "3107",
};
const server = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
  env,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
const worker = spawn(process.execPath, ["--import", "tsx", "src/worker.ts"], {
  env,
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
for (const p of [server, worker]) {
  p.stdout.on("data", (b) => (logs += b));
  p.stderr.on("data", (b) => (logs += b));
}
const base = "http://127.0.0.1:3107";
const password = "Test-only-" + randomUUID();
const nextPassword = "Changed-" + randomUUID();
let cookie = "";
let browser;
async function call(
  path,
  method = "GET",
  body,
  session = cookie,
  headers = {},
) {
  const r = await fetch(base + path, {
    method,
    redirect: "manual",
    headers: {
      "Content-Type": "application/json",
      "X-NexTech-Request": "1",
      ...(session ? { Cookie: session } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data;
  try {
    data = await r.json();
  } catch {}
  return { r, data };
}
async function until(fn) {
  for (let n = 0; n < 150; n++) {
    try {
      const result = await fn();
      if (result) return result;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error("Timeout. " + logs);
}
try {
  await until(async () => {
    const x = await call("/auth/status");
    return x.data?.databaseReady;
  });
  assert.equal((await call("/api/leads")).r.status, 401);
  assert.equal((await call("/")).r.status, 302);
  const rejected = await fetch(base + "/auth/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password }),
  });
  assert.equal(rejected.status, 403);
  const created = await call("/auth/setup", "POST", {
    username: "admin",
    password,
  });
  assert.equal(created.r.status, 201);
  const setCookie = created.r.headers.get("set-cookie");
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  cookie = setCookie.split(";")[0];
  const firstCookie = cookie;
  assert.equal(
    (await call("/auth/setup", "POST", { username: "other", password })).r
      .status,
    409,
  );
  const wrong = await call("/auth/login", "POST", {
    username: "admin",
    password: "wrong-password",
  });
  assert.equal(wrong.r.status, 401);
  const [rows] = await db.query("SELECT data FROM `" + dbName + "`.AppUser");
  const stored =
    typeof rows[0].data === "string" ? JSON.parse(rows[0].data) : rows[0].data;
  assert.notEqual(stored.passwordHash, password);
  assert.match(stored.passwordHash, /^scrypt:/);
  const [sessions] = await db.query(
    "SELECT id FROM `" + dbName + "`.AppSession",
  );
  assert.notEqual(sessions[0].id, cookie.split("=")[1]);
  const c = {
    name: "Conveniência — Brasil e Paraguai 🚚",
    country: "BR",
    region: "Mato Grosso do Sul",
    cities: ["Dourados"],
    scope: "city",
    segment: "conveniências",
    keywords: [],
    service: "sistema de gestão",
    maxLeads: 2,
    minScore: 40,
    language: "pt-BR",
    maxRequests: 20,
    maxCost: 2,
  };
  const campaign = await call("/api/campaigns", "POST", c);
  assert.equal(campaign.r.status, 201);
  const list = await call("/api/campaigns");
  assert.equal(list.data[0].name, c.name);
  const run = await call(
    "/api/campaigns/" + campaign.data.id + "/run",
    "POST",
    {},
  );
  assert.equal(run.r.status, 202);
  const finished = await until(async () => {
    const rows = (await call("/api/runs")).data;
    return rows?.find((r) => r.id === run.data.id && r.status === "concluída");
  });
  assert.equal(finished.newLeads, 2);
  const leads = (await call("/api/leads")).data;
  assert.equal(leads.length, 2);
  assert.ok(leads[0].lead.id);
  assert.equal(
    (
      await call("/api/leads/" + leads[0].lead.id + "/decision", "POST", {
        decision: "approve",
      })
    ).r.status,
    200,
  );
  assert.equal(
    (
      await call("/api/leads/" + leads[0].lead.id + "/decision", "POST", {
        decision: "pipeline",
      })
    ).r.status,
    200,
  );
  assert.equal(
    (
      await call("/auth/password", "POST", {
        currentPassword: password,
        newPassword: nextPassword,
      })
    ).r.status,
    200,
  );
  assert.equal(
    (await call("/api/leads", "GET", undefined, firstCookie)).r.status,
    401,
  );
  cookie = "";
  assert.equal(
    (await call("/auth/login", "POST", { username: "admin", password })).r
      .status,
    401,
  );
  const signed = await call("/auth/login", "POST", {
    username: "admin",
    password: nextPassword,
  });
  assert.equal(signed.r.status, 200);
  cookie = signed.r.headers.get("set-cookie").split(";")[0];
  assert.equal((await call("/auth/logout", "POST", {})).r.status, 200);
  assert.equal((await call("/api/leads")).r.status, 401);
  browser = await chromium.launch({
    headless: true,
    executablePath:
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/login");
  await page.locator("#submit:not([disabled])").waitFor();
  await page.screenshot({ path: "data/login-desktop.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "data/login-mobile.png", fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.locator("#password").fill(nextPassword);
  await page.locator("#submit").click();
  await page.waitForURL(base + "/");
  await page.locator("#m-leads").filter({ hasText: "2" }).waitFor();
  await page.getByRole("button", { name: "Sair", exact: true }).click();
  await page.waitForURL(base + "/login");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: MySQL schema, UTF-8 persistence, protected API, first-user setup, hashed passwords/sessions, wrong-password rejection, cookie flags, CSRF rejection, capture via BullMQ, approval/pipeline, password change/revocation, login/logout UI and mobile layout.",
  );
  await fs.writeFile(
    "data/mysql-test-result.json",
    JSON.stringify(
      {
        database: dbName,
        port,
        result: "passed",
        at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  server.kill();
  worker.kill();
  await db.end();
}
