import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { config, queuePrefix } from "./config.js";
export function redisConnection(worker = false) {
  const r = new Redis(config.redis, {
    maxRetriesPerRequest: worker ? null : 1,
    enableOfflineQueue: worker,
    lazyConnect: true,
    connectTimeout: 3000,
    retryStrategy: worker ? (times) => Math.min(times * 500, 5000) : () => null,
  });
  r.on("error", () => {});
  return r;
}
export const connection = redisConnection();
export const queue = new Queue("lead-campaigns", {
  connection,
  prefix: queuePrefix,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 100,
  },
});
queue.on("error", () => {});
let readiness: Promise<void> | undefined;
export async function ready() {
  if (connection.status !== "ready") {
    readiness ??= new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer);
        connection.off("ready", onReady);
        connection.off("error", onError);
        connection.off("end", onEnd);
        error ? reject(error) : resolve();
      };
      const onReady = () => finish();
      const onError = (error: Error) => finish(error);
      const onEnd = () => finish(new Error("Redis desconectado"));
      const timer = setTimeout(
        () => finish(new Error("Timeout conectando ao Redis")),
        4000,
      );
      connection.once("ready", onReady);
      connection.once("error", onError);
      connection.once("end", onEnd);
      if (connection.status === "wait" || connection.status === "end")
        connection.connect().catch(onError);
      else if (connection.status === "ready") finish();
    });
    try {
      await readiness;
    } finally {
      readiness = undefined;
    }
  }
  await connection.ping();
}
