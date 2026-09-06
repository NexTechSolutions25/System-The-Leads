import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { queue, ready, connection } from "../src/queue.ts";
import { put, all, getRun, createRun, updateRun, runs } from "../src/db.ts";
import { suppress } from "../src/leads.ts";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn) {
  for (let n = 0; n < 150; n++) {
    const value = await fn();
    if (value) return value;
    await wait(200);
  }
  throw Error("Timeout aguardando worker");
}
const id = randomUUID();
const c = {
  id,
  name: "DEMO · Validação Paraguai " + id.slice(0, 6),
  country: "PY",
  region: "ALTO PARANA",
  cities: ["CIUDAD DEL ESTE"],
  scope: "city",
  segment: "transportadoras de teste " + id.slice(0, 6),
  keywords: [],
  service: "sistema de gestão",
  maxLeads: 2,
  minScore: 40,
  language: "es",
  maxRequests: 20,
  maxCost: 2,
};
try {
  await ready();
  await put("Campaign", id, c);
  await put("ScheduledCampaign", id, { id, campaignId: id, active: true });
  await queue.upsertJobScheduler(
    id,
    { every: 10000 },
    { name: "capture", data: { campaignId: id } },
  );
  const scheduled = await until(async () =>
    (await runs()).find((r) => r.campaignId === id && r.status === "concluída"),
  );
  assert.equal(scheduled.newLeads, 2);
  assert.equal(scheduled.demo, true);
  await queue.removeJobScheduler(id);
  await put("ScheduledCampaign", id, { id, campaignId: id, active: false });
  const leads = (await all("CapturedLead")).filter((l) =>
    l.runIds.includes(scheduled.id),
  );
  assert.equal(leads.length, 2);
  assert.equal(
    (await all("QualificationResult")).find((q) => q.id === leads[0].id)
      .messages[0].language,
    "es",
  );
  const paused = await createRun(id);
  await updateRun(paused.id, { control: "paused" });
  await queue.add("capture", { campaignId: id, runId: paused.id });
  await until(async () => (await getRun(paused.id)).startedAt);
  await wait(300);
  assert.equal((await getRun(paused.id)).found, 0);
  await updateRun(paused.id, { control: "running" });
  await until(async () => (await getRun(paused.id)).status === "concluída");
  assert.equal((await getRun(paused.id)).duplicates, 2);
  await suppress(leads[0].id, true);
  const next = await createRun(id);
  await queue.add("capture", { campaignId: id, runId: next.id });
  await until(async () => (await getRun(next.id)).status === "concluída");
  assert.equal((await getRun(next.id)).newLeads, 0);
  assert.equal((await getRun(next.id)).duplicates, 1);
  assert.equal((await getRun(next.id)).rejected, 1);
  const cancelled = await createRun(id);
  await updateRun(cancelled.id, { control: "cancelled" });
  await queue.add("capture", { campaignId: id, runId: cancelled.id });
  await until(async () => (await getRun(cancelled.id)).status === "cancelada");
  assert.equal((await getRun(cancelled.id)).found, 0);
  console.log(
    "PASS: Redis/BullMQ scheduled trigger, Paraguay capture, Spanish messages, pause/resume, deduplication, suppression after deletion and cancellation.",
  );
} finally {
  await queue.removeJobScheduler(id).catch(() => {});
  await put("ScheduledCampaign", id, { id, campaignId: id, active: false });
  await queue.close();
  connection.disconnect();
}
