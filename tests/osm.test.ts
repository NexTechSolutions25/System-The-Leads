import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
process.env.DB_DRIVER = "sqlite";
process.env.DATABASE_PATH = "./data/osm-unit-" + randomUUID() + ".sqlite";
const { osmLead, osmQuery, OpenStreetMapProvider } =
  await import("../src/osm.js");
const { initDB, closeDB, remove } = await import("../src/db.js");
const input = {
  country: "BR" as const,
  region: "Mato Grosso do Sul",
  city: "Dourados",
  segment: "conveniência",
  keyword: "",
  language: "pt-BR" as const,
};
test("OSM only uses published contact fields and preserves source", () => {
  const base = {
    type: "node",
    id: 12,
    tags: {
      name: "Test fixture",
      shop: "convenience",
      phone: "+5567998765432",
    },
  };
  const lead = osmLead(base, input)!;
  assert.equal(lead.demo, false);
  assert.equal(lead.phone, "+5567998765432");
  assert.equal(lead.whatsapp, undefined);
  assert.equal(lead.sourceUrl, "https://www.openstreetmap.org/node/12");
  assert.equal(
    osmLead(
      {
        ...base,
        tags: {
          ...base.tags,
          "contact:whatsapp": "https://wa.me/5567998765432",
        },
      },
      input,
    )!.whatsapp,
    "+5567998765432",
  );
  assert.equal(
    osmLead(
      {
        ...base,
        tags: { ...base.tags, "contact:whatsapp": "https://evil.example/123" },
      },
      input,
    )!.whatsapp,
    undefined,
  );
  assert.equal(
    osmLead({ type: "area", id: 1, tags: base.tags }, input),
    undefined,
  );
});
test("OSM city boundaries, segment and literal escaping", () => {
  const q = osmQuery(input);
  assert.ok(q.includes("BR-MS"));
  assert.ok(q.includes("map_to_area->.city"));
  assert.ok(q.includes('["shop"="convenience"]'));
  assert.ok(
    osmQuery({ ...input, keyword: 'a.*"' }).includes(
      JSON.stringify('a\\.\\*"'),
    ),
  );
});
test("OSM failures never create demo data; cache and request throttling", async () => {
  await initDB();
  const original = globalThis.fetch;
  let calls = 0;
  const p = new OpenStreetMapProvider(async (_kind, _cost, fn) => fn());
  try {
    globalThis.fetch = async () => {
      calls++;
      return new Response("unavailable", { status: 503 });
    };
    await assert.rejects(() => p.searchCompanies(input), /503/);
    await assert.rejects(() => p.searchCompanies(input), /minuto/);
    assert.equal(calls, 1);
    await remove("AppMeta", "osm-rate");
    globalThis.fetch = async () => {
      calls++;
      return Response.json({ elements: [{ type: "area", id: 1 }] });
    };
    assert.deepEqual(await p.searchCompanies(input), []);
    assert.deepEqual(await p.searchCompanies(input), []);
    assert.equal(calls, 2);
    await remove("AppMeta", "osm-rate");
    await remove("AppMeta", "osm-cache");
    globalThis.fetch = async () =>
      Response.json({ elements: [], remark: "timeout" });
    await assert.rejects(() => p.searchCompanies(input), /consulta/);
  } finally {
    globalThis.fetch = original;
    await closeDB();
  }
});
