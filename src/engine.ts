import { randomUUID } from "node:crypto";
import { get, getRun, updateRun, put, transaction } from "./db.js";
import { config, now, sleep } from "./config.js";
import { provider, type Meter } from "./providers.js";
import { plan } from "./geography.js";
import { capture, suppressed } from "./leads.js";
import { analyzeWebsite } from "./analysis.js";
import { qualify } from "./qualification.js";
import { normalize } from "./normalize.js";
import type { Campaign, LeadProvider } from "./types.js";
export class Stop extends Error {}
export async function execute(
  runId: string,
  options: {
    provider?: LeadProvider;
    rateLimit?: () => Promise<void>;
  } = {},
) {
  const run = await getRun(runId);
  if (!run) throw Error("Execução não encontrada");
  const c = await get<Campaign>("Campaign", run.campaignId);
  if (!c) throw Error("Campanha não encontrada");
  if (["concluída", "concluída parcialmente", "cancelada"].includes(run.status))
    return;
  const check = async () => {
    let r = await getRun(runId);
    while (r.control === "paused") {
      await sleep(1000);
      r = await getRun(runId);
    }
    if (r.control === "cancelled") throw new Stop("cancelled");
  };
  const meter: Meter = async (kind, cost, call) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      await check();
      await options.rateLimit?.();
      const usageId = randomUUID();
      await transaction(async () => {
        const r = await getRun(runId);
        if (r.requests >= c.maxRequests || r.cost + cost > c.maxCost + 1e-9)
          throw new Stop("budget");
        const n = {
          ...r,
          requests: r.requests + 1,
          cost: Number((r.cost + cost).toFixed(6)),
        }; // reserve cost even on ambiguous network failures
        await put("ProviderUsage", usageId, {
          id: usageId,
          runId,
          provider: "google_places",
          kind,
          cost,
          at: now(),
          status: "reserved",
        });
        // updateRun has its own transaction, so write the reservation directly below.
        await query("UPDATE CampaignRun SET data=? WHERE id=?", [
          JSON.stringify(n),
          runId,
        ]);
      });
      try {
        const result = await call();
        await put("ProviderUsage", usageId, {
          id: usageId,
          runId,
          provider: "google_places",
          kind,
          cost,
          at: now(),
          status: "success",
        });
        return result;
      } catch (e) {
        await put("ProviderUsage", usageId, {
          id: usageId,
          runId,
          provider: "google_places",
          kind,
          cost,
          at: now(),
          status: "error",
        });
        if (!(e as any).retryable || attempt === 2) throw e;
        await sleep(1000 * 2 ** attempt);
      }
    }
  };
  const p = options.provider || provider(meter);
  await updateRun(runId, {
    status: "captando",
    provider: p.name,
    demo: p.name === "demonstration",
    startedAt: run.startedAt || now(),
  });
  const jobs = plan(c);
  await updateRun(runId, { totalBatches: jobs.length });
  const bump = async (field: string) => {
    const r = await getRun(runId);
    await updateRun(runId, { [field]: r[field] + 1 });
  };
  try {
    for (
      let index = (await getRun(runId)).cursor;
      index < jobs.length;
      index++
    ) {
      const input = jobs[index];
      let pageToken: string | undefined = (await getRun(runId)).pageToken;
      const searched = new Set<string>((await getRun(runId)).citiesSearched);
      searched.add(input.city);
      await updateRun(runId, {
        citiesSearched: [...searched],
        currentCity: input.city,
      });
      do {
        await check();
        if ((await getRun(runId)).processed.length >= c.maxLeads)
          throw new Stop("limit");
        await updateRun(runId, { status: "captando" });
        const batch = await p.searchCompanies({ ...input, pageToken });
        for (const external of batch) {
          await check();
          let r = await getRun(runId);
          const key = p.name + ":" + external.externalId;
          if (r.processed.includes(key)) continue;
          if (r.processed.length >= c.maxLeads) throw new Stop("limit");
          await updateRun(runId, { status: "enriquecendo" });
          let lead;
          try {
            lead = await p.getCompanyDetails(external.externalId);
          } catch (e) {
            if (e instanceof Stop) throw e;
            throw e;
          }
          if (
            lead.country !== c.country ||
            normalize(lead.city) !== normalize(input.city)
          ) {
            await bump("rejected");
            r = await getRun(runId);
            await updateRun(runId, { processed: [...r.processed, key] });
            continue;
          }
          lead.segment = c.segment;
          await bump("found");
          if (await suppressed(lead)) {
            await bump("rejected");
            r = await getRun(runId);
            await updateRun(runId, { processed: [...r.processed, key] });
            continue;
          }
          await updateRun(runId, { status: "analisando" });
          const analysis = await analyzeWebsite(lead.website, lead.country);
          if (analysis.whatsapp) lead.whatsapp = analysis.whatsapp;
          if (analysis.email) lead.email = analysis.email;
          if (analysis.instagram) lead.instagram = analysis.instagram;
          await check();
          const saved = await capture(lead, runId);
          if (saved.blocked) {
            await bump("rejected");
            r = await getRun(runId);
            await updateRun(runId, { processed: [...r.processed, key] });
            continue;
          }
          await bump(saved.duplicate ? "duplicates" : "newLeads");
          const persisted = await get("CapturedLead", saved.id);
          if (!persisted || persisted.doNotContact) {
            await bump("rejected");
            continue;
          }
          await updateRun(runId, { status: "qualificando" });
          const q = qualify(persisted, analysis, c);
          await transaction(async () => {
            await put("WebsiteAnalysis", saved.id, {
              ...analysis,
              id: saved.id,
              leadId: saved.id,
              at: now(),
            });
            await put("QualificationResult", saved.id, {
              ...q,
              id: saved.id,
              campaignId: c.id,
              at: now(),
            });
            const eid = randomUUID();
            await put("CollectionEvidence", eid, {
              id: eid,
              leadId: saved.id,
              runId,
              at: now(),
              kind: "qualification",
              analysis,
              qualification: q,
            });
            if (
              q.score >= c.minScore &&
              !(await get("ApprovalQueue", saved.id)) &&
              !(await get("Pipeline", saved.id))
            )
              await put("ApprovalQueue", saved.id, {
                id: saved.id,
                leadId: saved.id,
                campaignId: c.id,
                status: "pending",
                messages: q.messages,
                createdAt: now(),
              });
          });
          await bump(q.score >= c.minScore ? "qualified" : "rejected");
          r = await getRun(runId);
          await updateRun(runId, {
            processed: [...r.processed, key],
            progress: Math.min(
              99,
              Math.round(((r.processed.length + 1) / c.maxLeads) * 100),
            ),
          });
        }
        pageToken = p.nextPageToken;
        await updateRun(runId, { pageToken: pageToken || null });
      } while (pageToken);
      await updateRun(runId, { cursor: index + 1, pageToken: null });
    }
    await updateRun(runId, {
      status: (await getRun(runId)).errors.length
        ? "concluída parcialmente"
        : "concluída",
      finishedAt: now(),
      progress: 100,
    });
  } catch (e) {
    if (e instanceof Stop) {
      const cancelled = e.message === "cancelled";
      await updateRun(runId, {
        status: cancelled
          ? "cancelada"
          : e.message === "limit"
            ? "concluída"
            : "concluída parcialmente",
        finishReason: e.message,
        finishedAt: now(),
        progress: cancelled ? (await getRun(runId)).progress : 100,
      });
      return;
    }
    const r = await getRun(runId);
    await updateRun(runId, {
      status: "falhou",
      errors: [...r.errors, { at: now(), message: (e as Error).message }],
      finishedAt: now(),
    });
    throw e;
  }
}
import { query } from "./db.js";
