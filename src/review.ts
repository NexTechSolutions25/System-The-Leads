import { randomUUID } from "node:crypto";
import { get, put, transaction } from "./db.js";
import { analyzeWebsite } from "./analysis.js";
import { qualify } from "./qualification.js";
import { now } from "./config.js";
export async function reanalyze(id: string) {
  const l = await get("CapturedLead", id);
  if (!l || l.doNotContact) throw Error("Lead indisponível");
  const old = await get("QualificationResult", id);
  const c = await get("Campaign", old?.campaignId);
  if (!c) throw Error("Campanha não encontrada");
  const a = await analyzeWebsite(l.website, l.country);
  const q = qualify(l, a, c);
  await transaction(async () => {
    const current = await get("CapturedLead", id);
    if (!current || current.doNotContact) return;
    await put("WebsiteAnalysis", id, { ...a, id, leadId: id, at: now() });
    await put("QualificationResult", id, {
      ...q,
      id,
      campaignId: c.id,
      at: now(),
    });
    const e = randomUUID();
    await put("CollectionEvidence", e, {
      id: e,
      leadId: id,
      kind: "reanalyze",
      at: now(),
      analysis: a,
      qualification: q,
    });
    const approval = await get("ApprovalQueue", id);
    if (approval?.status === "pending")
      await put("ApprovalQueue", id, {
        ...approval,
        suggestedMessages: q.messages,
      });
  });
}
