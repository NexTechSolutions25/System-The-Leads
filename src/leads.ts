import { randomUUID } from "node:crypto";
import {
  query,
  get,
  put,
  all,
  remove,
  transaction,
  insertIdentity,
  insertSuppression,
} from "./db.js";
import { identities } from "./normalize.js";
import { now } from "./config.js";
import type { ExternalLead } from "./types.js";
export async function suppressed(l: ExternalLead) {
  for (const i of identities(l))
    if (
      (await query("SELECT identity FROM Suppression WHERE identity=?", [i]))
        .length
    )
      return true;
  return false;
}
export async function capture(l: ExternalLead, runId: string) {
  return transaction(async () => {
    if (await suppressed(l)) return { blocked: true, duplicate: false, id: "" };
    const ids = identities(l);
    let existing: any;
    for (const i of ids) {
      existing = (
        await query("SELECT leadId FROM LeadIdentity WHERE identity=?", [i])
      )[0];
      if (existing) break;
    }
    const id = existing?.leadId || randomUUID();
    const old = await get("CapturedLead", id);
    const merged: any = old
      ? { ...old }
      : { ...l, id, firstCollectedAt: now() };
    if (old)
      for (const [k, v] of Object.entries(l))
        if (
          (merged[k] === undefined || merged[k] === "" || merged[k] === null) &&
          v !== undefined
        )
          merged[k] = v;
    merged.lastSeenAt = now();
    merged.runIds = [...new Set([...(old?.runIds || []), runId])];
    await put("CapturedLead", id, merged);
    for (const i of ids) await insertIdentity(i, id);
    const eid = randomUUID();
    await put("CollectionEvidence", eid, {
      id: eid,
      leadId: id,
      runId,
      provider: l.provider,
      sourceUrl: l.sourceUrl,
      at: l.collectedAt,
      kind: "collection",
      snapshot: l,
    });
    return { blocked: false, duplicate: !!old, id };
  });
}
export async function suppress(id: string, erase = false) {
  return transaction(async () => {
    const l = await get("CapturedLead", id);
    if (!l) throw Error("Lead não encontrado");
    const keys = await query(
      "SELECT identity FROM LeadIdentity WHERE leadId=?",
      [id],
    );
    for (const row of keys) await insertSuppression(row.identity);
    await remove("ApprovalQueue", id);
    await remove("Pipeline", id);
    if (erase) {
      for (const t of [
        "CapturedLead",
        "WebsiteAnalysis",
        "QualificationResult",
      ])
        await remove(t, id);
      for (const e of await all("CollectionEvidence"))
        if (e.leadId === id) await remove("CollectionEvidence", e.id);
      await query("DELETE FROM LeadIdentity WHERE leadId=?", [id]);
    } else await put("CapturedLead", id, { ...l, doNotContact: true });
  });
}
