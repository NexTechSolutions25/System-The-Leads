import { authRouter, requireAuth, sessionUser } from "./auth.js";
import express from "express";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
import { config, now } from "./config.js";
import {
  all,
  get,
  put,
  runs,
  createRun,
  getRun,
  updateRun,
  transaction,
  initDB,
  databaseMessage,
  closeDB,
} from "./db.js";
import { seedGeo, cities, regions, campaignCities, plan } from "./geography.js";
const backend = config.freeMode ? await import("./free-queue.js") : await import("./queue.js");
const { ready, queue } = backend;
import { suppress } from "./leads.js";
import { whatsappLink } from "./normalize.js";
import type { Campaign } from "./types.js";

const app = express();
app.disable("x-powered-by");
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
const frontendOrigins = new Set((process.env.FRONTEND_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean));
app.use(express.json({ limit: "64kb" }));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
  );
  const allowedHosts = new Set([
    "127.0.0.1",
    "localhost",
    "[::1]",
    config.host,
    ...(process.env.ALLOWED_HOSTS || "").split(",").map(s => s.trim()),
    process.env.RENDER_EXTERNAL_HOSTNAME || "",
  ]);
  if (!allowedHosts.has(req.hostname))
    return res.status(403).json({ error: "Host não permitido" });
  if (
    req.headers.origin &&
    req.headers.origin !== `${req.protocol}://${req.headers.host}` &&
    !frontendOrigins.has(req.headers.origin)
  )
    return res.status(403).json({ error: "Origem não permitida" });
  if (req.headers.origin && frontendOrigins.has(req.headers.origin)) {
    res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.vary("Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-NexTech-Request");
    if (req.method === "OPTIONS") return res.sendStatus(204);
  }
  next();
});
app.use((req, res, next) => {
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    (req.path.startsWith("/api/") || req.path.startsWith("/auth/")) &&
    (req.headers["x-nextech-request"] !== "1" || !req.is("application/json"))
  )
    return res.status(403).json({ error: "Requisição não permitida" });
  next();
});
app.use("/auth", authRouter);
app.get("/login", (_req, res) => res.sendFile(resolve("public/login.html")));
app.get(["/", "/index.html"], async (req, res) => {
  try {
    if (await sessionUser(req))
      return res.sendFile(resolve("public/index.html"));
  } catch {}
  res.redirect("/login");
});
let geoInitialization: Promise<void> | undefined;
async function ensureGeo() {
  if (!geoInitialization)
    geoInitialization = (async () => {
      await initDB();
      if (!(await get("AppMeta", "geography-v1"))) {
        await seedGeo();
        await put("AppMeta", "geography-v1", { id: "geography-v1", at: now() });
      }
    })().catch((e) => {
      geoInitialization = undefined;
      throw e;
    });
  return geoInitialization;
}
app.use("/api", requireAuth, async (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    await ensureGeo();
    next();
  } catch {
    res.status(503).json({ error: databaseMessage() });
  }
});
app.get("/api/status", async (_req, res) => {
  let redis = false;
  try {
    await ready();
    redis = true;
  } catch {}
  res.json({
    database: config.dbDriver,
    freeMode: config.freeMode,
    queueMode: config.freeMode ? "database" : "redis",
    queueReady: redis,
    mode: config.key ? "real" : "demonstration",
    provider: config.key ? config.provider : "demonstration",
    keyConfigured: !!config.key,
    storageAuthorized:
      process.env.GOOGLE_PLACES_CRM_STORAGE_AUTHORIZED === "true",
    redis: config.freeMode ? false : redis,
    defaultCountry: process.env.DEFAULT_COUNTRY || "BR",
    defaultLanguage: process.env.DEFAULT_LANGUAGE || "pt-BR",
    message: config.freeMode ? "Modo gratuito: empresas fictícias, sem APIs pagas. Use Iniciar captação; agendas ficam indisponíveis neste modo." : config.key
      ? "Integração real configurada; uso em CRM exige autorização de armazenamento."
      : "Demonstração: somente empresas fictícias. Configure GOOGLE_PLACES_API_KEY para integrar o provedor real.",
    allowedHosts: config.allowedHosts,
    searchCost: config.freeMode ? 0 : config.searchCost,
    detailsCost: config.freeMode ? 0 : config.detailsCost,
  });
});
app.get("/api/locations", (req, res) => {
  const country = req.query.country === "PY" ? "PY" : "BR";
  const region = String(req.query.region || "");
  res.json({
    regions: regions.filter((r) => r.country === country),
    cities: cities.filter(
      (c) =>
        c.country === country &&
        (!region || c.region === region || c.code === region),
    ),
  });
});
const campaignSchema = z.object({
  name: z.string().trim().min(2).max(150),
  country: z.enum(["BR", "PY"]),
  region: z.string().max(100).default(""),
  cities: z.array(z.string().min(1).max(150)).max(6000).default([]),
  scope: z.enum(["city", "custom", "region", "national"]),
  segment: z.string().trim().min(2).max(150),
  keywords: z.array(z.string().trim().min(1).max(100)).max(20).default([]),
  service: z.string().trim().min(2).max(200),
  maxLeads: z.number().int().min(1).max(10000),
  minScore: z.number().min(0).max(100),
  language: z.enum(["pt-BR", "es", "both"]).optional(),
  maxRequests: z.number().int().min(1).max(100000),
  maxCost: z.number().positive().max(10000),
  schedule: z
    .object({
      frequency: z.enum(["daily", "weekly"]),
      days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
      time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      timezone: z.enum(["America/Sao_Paulo", "America/Asuncion"]),
    })
    .optional(),
});
app.get("/api/campaigns", async (_req, res) => {
  const rows = await all("Campaign");
  res.json(
    await Promise.all(
      rows.map(async (c) => ({
        ...c,
        scheduling: await get("ScheduledCampaign", c.id),
      })),
    ),
  );
});
app.post("/api/campaigns", async (req, res) => {
  const input = campaignSchema.parse(req.body);
  const c: Campaign = {
    ...input,
    id: randomUUID(),
    language: input.language || (input.country === "PY" ? "es" : "pt-BR"),
  };
  const locations = campaignCities(c);
  if (c.scope === "city" && locations.length !== 1)
    throw Error("Selecione uma cidade");
  await transaction(async () => {
    await put("Campaign", c.id, c);
    for (const city of locations)
      await put("CampaignLocation", c.id + "-" + city.id, {
        ...city,
        id: c.id + "-" + city.id,
        campaignId: c.id,
      });
  });
  res.status(201).json({ ...c, batches: plan(c).length });
});
app.post("/api/campaigns/:id/run", async (req, res) => {
  const c = await get<Campaign>("Campaign", req.params.id);
  if (!c) return res.status(404).json({ error: "Campanha não encontrada" });
  await ready();
  const r = await createRun(c.id);
  try {
    await queue.add(
      "capture",
      { runId: r.id, campaignId: c.id },
      { jobId: r.id },
    );
  } catch (e) {
    await updateRun(r.id, {
      status: "falhou",
      errors: [{ at: now(), message: "Não foi possível enfileirar" }],
    });
    throw e;
  }
  res.status(202).json(r);
});
app.post("/api/campaigns/:id/schedule", async (req, res) => {
  const c = await get<Campaign>("Campaign", req.params.id);
  if (!c?.schedule) throw Error("A campanha não possui horário configurado");
  await ready();
  const [hour, minute] = c.schedule.time.split(":");
  const pattern = `${minute} ${hour} * * ${c.schedule.frequency === "daily" ? "*" : c.schedule.days.join(",")}`;
  await queue.upsertJobScheduler(
    c.id,
    { pattern, tz: c.schedule.timezone },
    {
      name: "capture",
      data: { campaignId: c.id },
      opts: { attempts: 3, backoff: { type: "exponential", delay: 5000 } },
    },
  );
  await put("ScheduledCampaign", c.id, {
    id: c.id,
    campaignId: c.id,
    ...c.schedule,
    active: true,
  });
  res.json({ ok: true });
});
app.delete("/api/campaigns/:id/schedule", async (req, res) => {
  await ready();
  await queue.removeJobScheduler(req.params.id);
  const s = await get("ScheduledCampaign", req.params.id);
  if (s) await put("ScheduledCampaign", req.params.id, { ...s, active: false });
  res.json({ ok: true });
});
app.get("/api/schedules", async (_req, res) => {
  try {
    await ready();
    res.json(await queue.getJobSchedulers(0, 100, true));
  } catch {
    res.json([]);
  }
});
app.get("/api/runs", async (_req, res) => res.json(await runs()));
app.post("/api/runs/:id/:action", async (req, res) => {
  const { id, action } = req.params;
  const r = await getRun(id);
  if (!r) return res.status(404).json({ error: "Execução não encontrada" });
  if (action === "retry") {
    if (r.status !== "falhou")
      throw Error("Somente execuções com falha podem ser repetidas");
    await ready();
    await updateRun(id, { status: "aguardando", control: "running" });
    await queue.add("capture", { runId: id, campaignId: r.campaignId });
  } else {
    if (
      ["concluída", "concluída parcialmente", "falhou", "cancelada"].includes(
        r.status,
      )
    )
      throw Error("Execução já finalizada");
    if (!["pause", "resume", "cancel"].includes(action))
      throw Error("Ação inválida");
    await updateRun(id, {
      control:
        action === "pause"
          ? "paused"
          : action === "resume"
            ? "running"
            : "cancelled",
      ...(action === "cancel"
        ? { status: "cancelada", finishedAt: now() }
        : {}),
    });
  }
  res.json(await getRun(id));
});
const view = async (id: string) => ({
  lead: await get("CapturedLead", id),
  qualification: await get("QualificationResult", id),
  analysis: await get("WebsiteAnalysis", id),
  approval: await get("ApprovalQueue", id),
  pipeline: await get("Pipeline", id),
});
app.get("/api/leads", async (_req, res) =>
  res.json(
    await Promise.all((await all("CapturedLead")).map((l) => view(l.id))),
  ),
);
app.get("/api/leads/:id/evidence", async (req, res) =>
  res.json(
    (await all("CollectionEvidence")).filter((e) => e.leadId === req.params.id),
  ),
);
app.post("/api/leads/:id/reanalyze", async (req, res) => {
  const l = await get("CapturedLead", req.params.id);
  if (!l || l.doNotContact) throw Error("Lead indisponível");
  await ready();
  await queue.add("reanalyze", { leadId: l.id });
  res.status(202).json({ ok: true });
});
app.patch("/api/leads/:id/messages", async (req, res) => {
  const body = z
    .object({
      messages: z
        .array(
          z.object({
            language: z.enum(["pt-BR", "es"]),
            text: z.string().trim().min(1).max(5000),
          }),
        )
        .min(1)
        .max(2),
    })
    .parse(req.body);
  const a = await get("ApprovalQueue", req.params.id);
  const l = await get("CapturedLead", req.params.id);
  if (!a || !l || l.doNotContact) throw Error("Lead indisponível");
  const history = randomUUID();
  await transaction(async () => {
    await put("CollectionEvidence", history, {
      id: history,
      leadId: l.id,
      kind: "message_edit",
      previous: a.messages,
      at: now(),
    });
    await put("ApprovalQueue", l.id, {
      ...a,
      messages: body.messages,
      status: "pending",
      editedAt: now(),
    });
  });
  res.json(await view(l.id));
});
app.post("/api/leads/:id/decision", async (req, res) => {
  const { decision } = z
    .object({ decision: z.enum(["approve", "reject", "pipeline"]) })
    .parse(req.body);
  const id = req.params.id;
  const a = await get("ApprovalQueue", id);
  const l = await get("CapturedLead", id);
  if (!a || !l || l.doNotContact) throw Error("Lead indisponível");
  if (decision === "pipeline") {
    if (a.status !== "approved") throw Error("Aprovação humana necessária");
    await put("Pipeline", id, {
      id,
      leadId: id,
      stage: "novo",
      createdAt: now(),
    });
  } else
    await put("ApprovalQueue", id, {
      ...a,
      status: decision === "approve" ? "approved" : "rejected",
      reviewedAt: now(),
    });
  res.json(await view(id));
});
app.post("/api/leads/:id/whatsapp", async (req, res) => {
  const { message } = z
    .object({ message: z.string().trim().min(1).max(5000) })
    .parse(req.body);
  const l = await get("CapturedLead", req.params.id);
  if (!l || l.doNotContact) throw Error("Lead indisponível");
  const a = await get("ApprovalQueue", l.id);
  if (a?.status !== "approved")
    throw Error("Aprove o lead antes de abrir o WhatsApp");
  res.json({ url: whatsappLink(l, message) });
});
app.post("/api/leads/:id/privacy", async (req, res) => {
  const { action } = z
    .object({ action: z.enum(["do_not_contact", "delete", "anonymize"]) })
    .parse(req.body);
  await suppress(req.params.id, action !== "do_not_contact");
  res.json({
    ok: true,
    message:
      action === "do_not_contact"
        ? "Empresa bloqueada"
        : "Dados removidos; hashes de supressão mantidos para impedir recaptura",
  });
});
app.get("/api/usage", async (_req, res) =>
  res.json(await all("ProviderUsage")),
);
app.use(express.static(resolve("public"), { index: false }));
app.use(
  (
    err: any,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    const message =
      err instanceof z.ZodError
        ? err.issues.map((x) => x.path.join(".") + ": " + x.message).join("; ")
        : err.message || "Erro interno";
    res
      .status(err.status || 400)
      .json({
        error: err.code?.startsWith("ER_") ? databaseMessage() : message,
      });
  },
);
const server = app.listen(config.port, config.host, () =>
  console.log(`NexTech Leads em http://${config.host}:${config.port}`),
);
if (config.freeMode) (await import("./free-queue.js")).start();
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    server.close();
    await queue.close();
    if (!config.freeMode) (await import("./queue.js")).connection.disconnect();
    await closeDB();
    process.exit(0);
  });
