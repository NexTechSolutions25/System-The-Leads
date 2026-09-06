import { createHash } from "node:crypto";
import { resolve } from "node:path";
import "dotenv/config";
export const config = {
  dbDriver: process.env.DB_DRIVER || "mysql",
  mysql: {
    host: process.env.MYSQL_HOST || "127.0.0.1",
    port: Number(process.env.MYSQL_PORT || 3306),
    database: process.env.MYSQL_DATABASE || "nextech_leads",
    user: process.env.MYSQL_USER || "root",
    password: process.env.MYSQL_PASSWORD || "",
  },
  key: process.env.GOOGLE_PLACES_API_KEY?.trim() || "",
  provider: process.env.LEAD_PROVIDER || "google_places",
  redis: process.env.REDIS_URL || "redis://127.0.0.1:6379",
  db: process.env.DATABASE_PATH || "./data/leads.sqlite",
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || "127.0.0.1",
  searchCost: Number(process.env.GOOGLE_SEARCH_REQUEST_USD || 0.04),
  detailsCost: Number(process.env.GOOGLE_DETAILS_REQUEST_USD || 0.03),
  interval: Math.max(1000, Number(process.env.PROVIDER_INTERVAL_MS || 1100)),
  concurrency: Math.max(
    1,
    Math.min(10, Number(process.env.WORKER_CONCURRENCY || 2)),
  ),
  allowedHosts: (process.env.WEBSITE_ALLOWED_HOSTS || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean),
};
if (
  ![config.searchCost, config.detailsCost].every(
    (x) => Number.isFinite(x) && x > 0,
  )
)
  throw Error("Configure custos positivos por consulta");
export const now = () => new Date().toISOString();
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

if (!["mysql", "sqlite"].includes(config.dbDriver))
  throw Error("DB_DRIVER deve ser mysql ou sqlite");

export const queuePrefix =
  "nextech-" +
  createHash("sha256")
    .update(
      config.dbDriver === "mysql"
        ? [config.mysql.host, config.mysql.port, config.mysql.database].join(
            ":",
          )
        : resolve(config.db),
    )
    .digest("hex")
    .slice(0, 16);
