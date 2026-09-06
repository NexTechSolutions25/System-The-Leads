import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { config, now } from "../src/config.js";
import {
  all,
  get,
  put,
  query,
  transaction,
  initDB,
  closeDB,
  documentTables,
  insertIdentity,
  insertSuppression,
} from "../src/db.js";
if (config.dbDriver !== "mysql")
  throw Error("Configure DB_DRIVER=mysql antes de importar.");
const sourcePath = resolve(process.env.SQLITE_IMPORT_PATH || config.db);
let source: DatabaseSync | undefined;
try {
  await initDB();
  if (await get("AppMeta", "sqlite-import-v1"))
    throw Error(
      "Esta importação já foi concluída. Reimportar uma cópia antiga poderia restaurar dados excluídos.",
    );
  source = new DatabaseSync(sourcePath, { readOnly: true });
  source.exec("BEGIN");
  const tables = new Set(
    (
      source
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as any[]
    ).map((r) => r.name),
  );
  const snapshots = new Map<string, any[]>();
  for (const t of [
    ...documentTables.filter((t) => !t.startsWith("App")),
    "CampaignRun",
    "LeadIdentity",
    "Suppression",
  ])
    if (tables.has(t))
      snapshots.set(
        t,
        source.prepare('SELECT * FROM "' + t + '"').all() as any[],
      );
  source.exec("COMMIT");
  source.close();
  source = undefined;
  const counts: Record<string, number> = {};
  await transaction(async () => {
    if (await get("AppMeta", "sqlite-import-v1"))
      throw Error("Importação já concluída.");
    if ((await all("CapturedLead")).length || (await all("Campaign")).length)
      throw Error(
        "O destino já possui campanhas ou leads. A importação automática exige destino vazio para não misturar registros.",
      );
    for (const t of documentTables.filter((t) => !t.startsWith("App"))) {
      counts[t] = 0;
      for (const row of snapshots.get(t) || []) {
        if (await get(t, row.id)) continue;
        let data = JSON.parse(row.data);
        if (t === "ScheduledCampaign") data = { ...data, active: false };
        await put(t, row.id, data);
        counts[t]++;
      }
    }
    counts.CampaignRun = 0;
    for (const r of snapshots.get("CampaignRun") || []) {
      if ((await query("SELECT id FROM CampaignRun WHERE id=?", [r.id])).length)
        continue;
      const active = ![
        "concluída",
        "concluída parcialmente",
        "falhou",
        "cancelada",
      ].includes(r.status);
      let data = JSON.parse(r.data);
      if (active)
        data = { ...data, finishedAt: now(), finishReason: "sqlite_migration" };
      await query(
        "INSERT INTO CampaignRun(id,campaignId,status,control,data) VALUES(?,?,?,?,?)",
        [
          r.id,
          r.campaignId,
          active ? "cancelada" : r.status,
          active ? "cancelled" : r.control,
          JSON.stringify(data),
        ],
      );
      counts.CampaignRun++;
    }
    for (const r of snapshots.get("LeadIdentity") || [])
      await insertIdentity(r.identity, r.leadId);
    for (const r of snapshots.get("Suppression") || [])
      await insertSuppression(r.identity, r.createdAt);
    await put("AppMeta", "sqlite-import-v1", {
      id: "sqlite-import-v1",
      at: now(),
      counts,
    });
  });
  console.log(
    "Importação concluída. SQLite original preservado. Agendas importadas ficam pausadas para revisão.",
  );
  console.log(JSON.stringify(counts, null, 2));
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
} finally {
  source?.close();
  await closeDB();
}
