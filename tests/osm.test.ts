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
  assert.ok(q.includes("5003702"));
  assert.ok(q.includes("IBGE:GEOCODIGO"));
  assert.ok(q.includes('["shop"="convenience"]'));
  assert.ok(
    osmQuery({ ...input, keyword: 'a.*"' }).includes(
      JSON.stringify('a\\.\\*"'),
    ),
  );
});

test('OSM waits for a slot and recovers transient errors without fake data', async()=>{
 await initDB();const original=globalThis.fetch;const waits:number[]=[];const urls:string[]=[];let calls=0;
 const p=new OpenStreetMapProvider(async(_kind,cost,fn)=>{assert.equal(cost,0);return fn();},async(ms)=>{waits.push(ms)});
 const clear=async()=>{await remove('AppMeta','osm-rate');await remove('AppMeta','osm-cache');calls=0;urls.length=0;waits.length=0;};
 try{
 globalThis.fetch=async(url)=>{urls.push(String(url));calls++;return calls===1?new Response('unavailable',{status:503}):Response.json({elements:[{type:'area',id:1},{type:'node',id:42,tags:{name:'Test fixture',shop:'convenience'}}]});};
 const rows=await p.searchCompanies(input);assert.equal(rows.length,1);assert.equal(rows[0].demo,false);assert.equal(calls,2);assert.ok(waits[0]>50000);assert.ok(urls[0].includes('maps.mail.ru'));assert.ok(urls[1].includes('overpass.private.coffee'));
 await p.searchCompanies(input);assert.equal(calls,2);
 await clear();
 globalThis.fetch=async()=>{calls++;return new Response('rate limited',{status:429})};
 await assert.rejects(()=>p.searchCompanies(input),/429/);assert.equal(calls,1);
 await clear();
 globalThis.fetch=async()=>{calls++;throw new TypeError('network unavailable')};
 await assert.rejects(()=>p.searchCompanies(input),/fonte gratuita/);assert.equal(calls,2);
 await clear();
 globalThis.fetch=async()=>{calls++;return Response.json({elements:[{type:'area',id:1}]})};
 assert.deepEqual(await p.searchCompanies(input),[]);assert.deepEqual(await p.searchCompanies(input),[]);assert.equal(calls,1);
 }finally{globalThis.fetch=original;await closeDB();}
});
