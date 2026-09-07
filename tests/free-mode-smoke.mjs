import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
const env = {
  ...process.env,
  FREE_MODE: "true",
  NEXTECH_OSM_FIXTURE: "true",
  DB_DRIVER: "sqlite",
  DATABASE_PATH: "./data/free-test-" + randomUUID() + ".sqlite",
  HOST: "127.0.0.1",
  PORT: "3196",
  REDIS_URL: "redis://127.0.0.1:1",
  GOOGLE_PLACES_API_KEY: "must-not-be-used",
  GOOGLE_PLACES_CRM_STORAGE_AUTHORIZED: "true",
};
let child;
let cookie = "";
const wait = async (fn) => {
  for (let i = 0; i < 100; i++) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error("Timeout");
};
async function start() {
  child = spawn(
    process.execPath,
    [
      "--import",
      "./tests/osm-fixture-register.mjs",
      "--import",
      "tsx",
      "src/server.ts",
    ],
    { env, stdio: "ignore" },
  );
  await wait(async () => (await fetch("http://127.0.0.1:3196/auth/status")).ok);
}
async function stop() {
  const done = new Promise((r) => child.once("exit", r));
  child.kill();
  await done;
}
async function call(path, method = "GET", body) {
  const r = await fetch("http://127.0.0.1:3196" + path, {
    method,
    headers: {
      "content-type": "application/json",
      "x-nextech-request": "1",
      cookie,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.headers.get("set-cookie"))
    cookie = r.headers.get("set-cookie").split(";")[0];
  return { status: r.status, data: await r.json() };
}
try {
  await start();
  assert.equal(
    (
      await call("/auth/setup", "POST", {
        username: "free-test",
        password: randomUUID(),
      })
    ).status,
    201,
  );
  const status = (await call("/api/status")).data;
  assert.equal(status.queueMode, "database");
  assert.equal(status.queueReady, true);
  assert.equal(status.keyConfigured, false);
  assert.equal(status.mode, "real");
  assert.equal(status.redis, false);
  const c = (
    await call("/api/campaigns", "POST", {
      name: "Teste gratuito",
      country: "BR",
      region: "Mato Grosso do Sul",
      cities: ["Dourados"],
      scope: "city",
      segment: "conveniencias",
      keywords: [],
      service: "sistema de gestao",
      maxLeads: 2,
      minScore: 0,
      language: "pt-BR",
      maxRequests: 20,
      maxCost: 2,
      schedule: {
        frequency: "daily",
        days: [1],
        time: "09:00",
        timezone: "America/Sao_Paulo",
      },
    })
  ).data;
  assert.ok(c.id);
  assert.equal(
    (await call("/api/campaigns/" + c.id + "/schedule", "POST", {})).status,
    400,
  );
  const run = (await call("/api/campaigns/" + c.id + "/run", "POST", {})).data;
  const completed = await wait(async () =>
    (await call("/api/runs")).data.find(
      (x) => x.id === run.id && x.status === "concluída",
    ),
  );
  assert.equal(completed.cost, 0);
  assert.equal(completed.requests, 1);
  assert.equal(completed.newLeads, 2);
  const leads = (await call("/api/leads")).data;
  assert.equal(leads.length, 2);
  assert.ok(
    leads.every(
      (x) => x.lead.demo === false && x.lead.provider === "openstreetmap",
    ),
  );
  assert.equal(leads.filter((x) => x.lead.whatsapp).length, 1);
  const second = (await call("/api/campaigns/" + c.id + "/run", "POST", {}))
    .data;
  await call("/api/runs/" + second.id + "/pause", "POST", {});
  await stop();
  await start();
  assert.ok((await call("/api/runs")).data.find((x) => x.id === second.id));
  const saved = (await call("/api/runs")).data.find((x) => x.id === second.id);
  if (saved.status !== "concluída") {
    assert.equal(saved.control, "paused");
    await call("/api/runs/" + second.id + "/resume", "POST", {});
  }
  await wait(async () =>
    (await call("/api/runs")).data.find(
      (x) => x.id === second.id && x.status === "concluída",
    ),
  );
  assert.equal((await call("/api/leads")).data.length, 2);
  console.log(
    "PASS: API sem Redis, chave paga ignorada, OpenStreetMap simulado em banco isolado com custo zero, agenda recusada, tarefa persistida apos reinicio, retomada e deduplicacao.",
  );
} finally {
  if (child?.exitCode === null) await stop();
}
