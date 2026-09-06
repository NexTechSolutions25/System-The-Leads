import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import mysql, { type Pool, type PoolConnection } from "mysql2/promise";
import { config, now } from "./config.js";
export const documentTables = [
  "Country",
  "Region",
  "City",
  "LeadProvider",
  "ProviderCredential",
  "Campaign",
  "CampaignLocation",
  "ScheduledCampaign",
  "CapturedLead",
  "WebsiteAnalysis",
  "QualificationResult",
  "ApprovalQueue",
  "Pipeline",
  "ProviderUsage",
  "CollectionEvidence",
  "AppUser",
  "AppSession",
  "AppMeta",
];
const allowed = new Set(documentTables);
const local = new AsyncLocalStorage<{ connection?: PoolConnection }>();
let sqlite: DatabaseSync | undefined,
  pool: Pool | undefined,
  initializing: Promise<void> | undefined,
  initialized = false;
let tail: Promise<void> = Promise.resolve();
async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const previous = tail;
  let unlock!: () => void;
  tail = new Promise<void>((r) => (unlock = r));
  await previous;
  try {
    return await fn();
  } finally {
    unlock();
  }
}
function table(t: string) {
  if (!allowed.has(t)) throw Error("Tabela inválida");
  return "`" + t + "`";
}
export function databaseMessage() {
  return config.dbDriver === "mysql"
    ? "Não foi possível conectar ao MySQL. Confira MYSQL_HOST, MYSQL_PORT, MYSQL_DATABASE, MYSQL_USER e MYSQL_PASSWORD no arquivo .env e reinicie a aplicação."
    : "Não foi possível abrir o banco local.";
}
export async function initDB() {
  if (initialized) return;
  if (initializing) return initializing;
  initializing = (async () => {
    if (config.dbDriver === "sqlite") {
      mkdirSync(dirname(config.db), { recursive: true });
      sqlite = new DatabaseSync(config.db);
      sqlite.exec(
        "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=10000; PRAGMA foreign_keys=ON;",
      );
      for (const t of documentTables)
        sqlite.exec(
          `CREATE TABLE IF NOT EXISTS ${table(t)}(id TEXT PRIMARY KEY,data TEXT NOT NULL)`,
        );
      sqlite.exec(
        `CREATE TABLE IF NOT EXISTS CampaignRun(id TEXT PRIMARY KEY,campaignId TEXT NOT NULL,status TEXT NOT NULL,control TEXT NOT NULL DEFAULT 'running',data TEXT NOT NULL);CREATE TABLE IF NOT EXISTS LeadIdentity(identity TEXT PRIMARY KEY,leadId TEXT NOT NULL);CREATE TABLE IF NOT EXISTS Suppression(identity TEXT PRIMARY KEY,createdAt TEXT NOT NULL);CREATE INDEX IF NOT EXISTS run_campaign ON CampaignRun(campaignId);CREATE INDEX IF NOT EXISTS identity_lead ON LeadIdentity(leadId);`,
      );
    } else {
      pool = mysql.createPool({
        host: config.mysql.host,
        port: config.mysql.port,
        user: config.mysql.user,
        password: config.mysql.password,
        database: config.mysql.database,
        connectionLimit: 5,
        connectTimeout: 5000,
        charset: "utf8mb4",
        multipleStatements: false,
        jsonStrings: true,
        timezone: "Z",
      });
      try {
        await pool.query("SELECT 1");
        const schema = readFileSync(
          new URL("../sql/mysql-schema.sql", import.meta.url),
          "utf8",
        )
          .replace(/^\uFEFF/, "")
          .replace(/^\s*--.*$/gm, "");
        for (const statement of schema
          .split(";")
          .map((s) => s.trim())
          .filter(Boolean)) {
          if (/^(USE|SHOW)\b/i.test(statement)) continue;
          await pool.query(statement);
        }
        for (const t of ["AppUser", "AppSession", "AppMeta"])
          await pool.query(
            `CREATE TABLE IF NOT EXISTS ${table(t)} (id VARCHAR(255) COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,data JSON NOT NULL) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
          );
        await pool.query(
          "CREATE TABLE IF NOT EXISTS AppMutex (id INT NOT NULL PRIMARY KEY) ENGINE=InnoDB",
        );
        await pool.query("INSERT IGNORE INTO AppMutex(id) VALUES(1)");
      } catch {
        await pool.end().catch(() => {});
        pool = undefined;
        throw Error(databaseMessage());
      }
    }
    initialized = true;
  })();
  try {
    await initializing;
  } finally {
    initializing = undefined;
  }
}
export async function query(sql: string, params: any[] = []): Promise<any> {
  await initDB();
  if (config.dbDriver === "mysql") {
    const [result] = await (local.getStore()?.connection || pool!).execute(
      sql,
      params,
    );
    return result;
  }
  const run = async () => {
    const stmt = sqlite!.prepare(sql);
    return /^\s*(SELECT|PRAGMA|WITH)\b/i.test(sql)
      ? stmt.all(...params)
      : stmt.run(...params);
  };
  return local.getStore() ? run() : exclusive(run);
}
export async function transaction<T>(fn: () => Promise<T> | T): Promise<T> {
  await initDB();
  if (local.getStore()) return fn();
  if (config.dbDriver === "sqlite")
    return exclusive(async () => {
      sqlite!.exec("BEGIN IMMEDIATE");
      try {
        const r = await local.run({}, fn);
        sqlite!.exec("COMMIT");
        return r;
      } catch (e) {
        sqlite!.exec("ROLLBACK");
        throw e;
      }
    });
  const connection = await pool!.getConnection();
  try {
    await connection.beginTransaction();
    await connection.query("SELECT id FROM AppMutex WHERE id=1 FOR UPDATE");
    const result = await local.run({ connection }, fn);
    await connection.commit();
    return result;
  } catch (e) {
    await connection.rollback();
    throw e;
  } finally {
    connection.release();
  }
}
const decode = (s: any) => (typeof s === "string" ? JSON.parse(s) : s);
export async function get<T = any>(
  t: string,
  id: string,
): Promise<T | undefined> {
  const rows = await query(`SELECT data FROM ${table(t)} WHERE id=?`, [id]);
  return rows[0] ? decode(rows[0].data) : undefined;
}
export async function all<T = any>(t: string): Promise<T[]> {
  return (await query(`SELECT data FROM ${table(t)}`)).map((r: any) =>
    decode(r.data),
  );
}
export async function put(t: string, id: string, data: unknown) {
  return transaction(async () => {
    const target = table(t);
    const suffix =
      config.dbDriver === "mysql"
        ? "ON DUPLICATE KEY UPDATE data=VALUES(data)"
        : "ON CONFLICT(id) DO UPDATE SET data=excluded.data";
    await query(`INSERT INTO ${target}(id,data) VALUES(?,?) ${suffix}`, [
      id,
      JSON.stringify(data),
    ]);
  });
}
export async function remove(t: string, id: string) {
  return transaction(() => query(`DELETE FROM ${table(t)} WHERE id=?`, [id]));
}
export async function insertIdentity(identity: string, leadId: string) {
  const prefix =
    config.dbDriver === "mysql" ? "INSERT IGNORE" : "INSERT OR IGNORE";
  await query(`${prefix} INTO LeadIdentity(identity,leadId) VALUES(?,?)`, [
    identity,
    leadId,
  ]);
}
export async function insertSuppression(identity: string, createdAt = now()) {
  const prefix =
    config.dbDriver === "mysql" ? "INSERT IGNORE" : "INSERT OR IGNORE";
  await query(`${prefix} INTO Suppression(identity,createdAt) VALUES(?,?)`, [
    identity,
    createdAt,
  ]);
}
export async function getRun(id: string): Promise<any> {
  const rows = await query("SELECT * FROM CampaignRun WHERE id=?", [id]);
  const r = rows[0];
  return r
    ? {
        ...decode(r.data),
        id: r.id,
        campaignId: r.campaignId,
        status: r.status,
        control: r.control,
      }
    : undefined;
}
export async function updateRun(id: string, patch: any) {
  return transaction(async () => {
    const r = await getRun(id);
    if (!r) throw Error("Execução não encontrada");
    const n = { ...r, ...patch };
    await query("UPDATE CampaignRun SET status=?,control=?,data=? WHERE id=?", [
      n.status,
      n.control,
      JSON.stringify(n),
      id,
    ]);
  });
}
export async function runs() {
  const rows = await query(
    `SELECT * FROM CampaignRun ORDER BY ${config.dbDriver === "mysql" ? "runSequence" : "rowid"} DESC LIMIT 100`,
  );
  return rows.map((r: any) => ({
    ...decode(r.data),
    id: r.id,
    campaignId: r.campaignId,
    status: r.status,
    control: r.control,
  }));
}
export async function createRun(campaignId: string, id: string = randomUUID()) {
  return transaction(async () => {
    const existing = await getRun(id);
    if (existing) return existing;
    await query(
      "INSERT INTO CampaignRun(id,campaignId,status,control,data) VALUES(?,?,?,?,?)",
      [
        id,
        campaignId,
        "aguardando",
        "running",
        JSON.stringify({
          createdAt: now(),
          requests: 0,
          cost: 0,
          found: 0,
          newLeads: 0,
          duplicates: 0,
          qualified: 0,
          rejected: 0,
          errors: [],
          cursor: 0,
          processed: [],
          citiesSearched: [],
          progress: 0,
        }),
      ],
    );
    return getRun(id);
  });
}
export async function closeDB() {
  await tail;
  await pool?.end();
  sqlite?.close();
  pool = undefined;
  sqlite = undefined;
  initialized = false;
}
