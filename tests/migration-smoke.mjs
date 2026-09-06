import { DatabaseSync } from "node:sqlite";
import mysql from "mysql2/promise";
import fs from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
const id = randomUUID().replaceAll("-", "");
const file = "data/migration-fixture-" + id + ".sqlite";
const database = "nextech_migration_test_" + id;
const port = process.env.TEST_MYSQL_PORT || "13307";
const source = new DatabaseSync(file);
for (const t of ["Campaign", "CapturedLead", "ScheduledCampaign"])
  source.exec(`CREATE TABLE ${t}(id TEXT PRIMARY KEY,data TEXT NOT NULL)`);
source
  .prepare("INSERT INTO Campaign VALUES(?,?)")
  .run("c", JSON.stringify({ id: "c", name: "Migração 🚚" }));
source
  .prepare("INSERT INTO CapturedLead VALUES(?,?)")
  .run("l", JSON.stringify({ id: "l", name: "Empresa fictícia", demo: true }));
source
  .prepare("INSERT INTO ScheduledCampaign VALUES(?,?)")
  .run("c", JSON.stringify({ id: "c", active: true }));
source.exec(
  "CREATE TABLE CampaignRun(id TEXT PRIMARY KEY,campaignId TEXT,status TEXT,control TEXT,data TEXT);CREATE TABLE LeadIdentity(identity TEXT PRIMARY KEY,leadId TEXT);CREATE TABLE Suppression(identity TEXT PRIMARY KEY,createdAt TEXT);",
);
source
  .prepare("INSERT INTO CampaignRun VALUES(?,?,?,?,?)")
  .run("r", "c", "captando", "running", "{}");
source
  .prepare("INSERT INTO Suppression VALUES(?,?)")
  .run("a".repeat(64), new Date().toISOString());
source.close();
const hash = async () =>
  createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
const before = await hash();
const db = await mysql.createConnection({
  host: "127.0.0.1",
  port: Number(port),
  user: "root",
  password: process.env.TEST_MYSQL_PASSWORD || "",
});
await db.query("CREATE DATABASE `" + database + "` CHARACTER SET utf8mb4");
const env = {
  ...process.env,
  DB_DRIVER: "mysql",
  MYSQL_HOST: "127.0.0.1",
  MYSQL_PORT: port,
  MYSQL_DATABASE: database,
  MYSQL_USER: "root",
  MYSQL_PASSWORD: process.env.TEST_MYSQL_PASSWORD || "",
  SQLITE_IMPORT_PATH: file,
};
async function migrate() {
  return new Promise((resolve) => {
    const p = spawn(
      process.execPath,
      ["--import", "tsx", "scripts/migrate-sqlite.ts"],
      { env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    let output = "";
    p.stdout.on("data", (b) => (output += b));
    p.stderr.on("data", (b) => (output += b));
    p.on("exit", (code) => resolve({ code, output }));
  });
}
try {
  const first = await migrate();
  assert.equal(first.code, 0, first.output);
  assert.equal(await hash(), before);
  const [runs] = await db.query(
    "SELECT status,control FROM `" + database + "`.CampaignRun",
  );
  assert.equal(runs[0].status, "cancelada");
  const [schedules] = await db.query(
    "SELECT data FROM `" + database + "`.ScheduledCampaign",
  );
  const schedule =
    typeof schedules[0].data === "string"
      ? JSON.parse(schedules[0].data)
      : schedules[0].data;
  assert.equal(schedule.active, false);
  const [suppression] = await db.query(
    "SELECT identity FROM `" + database + "`.Suppression",
  );
  assert.equal(suppression.length, 1);
  const second = await migrate();
  assert.equal(second.code, 1);
  console.log(
    "PASS: SQLite to MySQL migration preserves source, imports suppression, pauses schedules, cancels in-flight runs and prevents accidental reimport.",
  );
} finally {
  await db.end();
}
