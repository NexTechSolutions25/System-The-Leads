import { Worker } from "bullmq";
import { redisConnection } from "./queue.js";
import { config, sleep, now, queuePrefix } from "./config.js";
import { createRun, getRun, updateRun, get } from "./db.js";
import { execute } from "./engine.js";
const connection = redisConnection(true);
const rateLimit = async () => {
  while (true) {
    const ok = await connection.set(
      "lead-provider-rate-limit",
      "1",
      "PX",
      config.interval,
      "NX",
    );
    if (ok) return;
    await sleep(200);
  }
};
const worker = new Worker(
  "lead-campaigns",
  async (job) => {
    if (job.name === "reanalyze") {
      const { reanalyze } = await import("./review.js");
      return reanalyze(job.data.leadId);
    }
    if (
      !job.data.runId &&
      !(await get("ScheduledCampaign", job.data.campaignId))?.active
    )
      return;
    const id = job.data.runId || "scheduled-" + job.id;
    await createRun(job.data.campaignId, id);
    const lockKey = "lead-run-lock:" + id;
    const lockToken = String(job.id) + ":" + Date.now();
    if (!(await connection.set(lockKey, lockToken, "PX", 90000, "NX")))
      throw Error("Execução já está sendo processada");
    const heartbeat = setInterval(
      () =>
        connection
          .eval(
            "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('pexpire',KEYS[1],90000) end",
            1,
            lockKey,
            lockToken,
          )
          .catch(() => {}),
      20000,
    );
    try {
      await execute(id, { rateLimit });
    } catch (e) {
      if ((await getRun(id))?.status !== "falhou")
        await updateRun(id, {
          status: "falhou",
          errors: [{ at: now(), message: (e as Error).message }],
        });
      throw e;
    } finally {
      clearInterval(heartbeat);
      await connection.eval(
        "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) end",
        1,
        lockKey,
        lockToken,
      );
    }
  },
  { connection, prefix: queuePrefix, concurrency: config.concurrency },
);
worker.on("error", (e) => console.error("Worker:", e.message));
worker.on("failed", (job, e) => console.error("Job", job?.id, e.message));
console.log("Worker iniciado. Aguardando Redis e campanhas.");
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await worker.close();
    await connection.quit();
    process.exit(0);
  });
