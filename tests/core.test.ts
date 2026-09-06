import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
process.env.DB_DRIVER = "sqlite";
process.env.DATABASE_PATH = "./data/test-" + randomUUID() + ".sqlite";
const { phone, whatsappLink, identities } = await import("../src/normalize.js");
const { qualify } = await import("../src/qualification.js");
const { publicIP, analyzeWebsite } = await import("../src/analysis.js");
const { GooglePlacesProvider, DemoProvider } =
  await import("../src/providers.js");
const { capture, suppress, suppressed } = await import("../src/leads.js");
const { get, put, createRun, getRun, updateRun } = await import("../src/db.js");
const { execute } = await import("../src/engine.js");
const { plan, regions, cities } = await import("../src/geography.js");
import type { ExternalLead, Campaign } from "../src/types.js";
const campaign: Campaign = {
  id: "c",
  name: "Teste",
  country: "BR",
  region: "Mato Grosso do Sul",
  cities: ["Dourados"],
  scope: "city",
  segment: "imobiliárias",
  keywords: [],
  service: "sistema de gestão",
  maxLeads: 6,
  minScore: 40,
  language: "pt-BR",
  maxRequests: 20,
  maxCost: 2,
};
const lead: ExternalLead = {
  externalId: "abc",
  name: "Empresa de Teste",
  provider: "test",
  country: "BR",
  region: campaign.region,
  city: "Dourados",
  phone: "+5567999991234",
  category: "imobiliárias",
  collectedAt: new Date().toISOString(),
  demo: false,
};
test("Normalização internacional e WhatsApp exigem identificação pública", () => {
  assert.equal(phone("(67) 99999-1234", "BR"), "+5567999991234");
  assert.equal(phone("0981 123456", "PY"), "+595981123456");
  assert.throws(() => whatsappLink(lead, "Olá"));
  assert.match(
    whatsappLink({ ...lead, whatsapp: lead.phone }, "Olá & sí"),
    /^https:\/\/wa.me\/5567999991234\?text=Ol%C3%A1%20%26%20s%C3%AD$/,
  );
  assert.throws(() =>
    whatsappLink({ ...lead, demo: true, whatsapp: lead.phone }, "Olá"),
  );
});
test("Qualificação distingue dado ausente de problema comprovado", () => {
  const q = qualify(
    { ...lead, phone: undefined },
    { status: "sem_site_informado", evidence: [] },
    campaign,
  );
  assert.ok(q.score < 70);
  assert.match(q.opportunity, /Verificar/);
  assert.equal(q.messages[0].language, "pt-BR");
  const es = qualify(
    lead,
    { status: "sem_site_informado", evidence: [] },
    { ...campaign, language: "es" },
  );
  assert.match(es.messages[0].text, /sistemas de gestión/);
  assert.equal(
    qualify(
      lead,
      { status: "x", evidence: [] },
      { ...campaign, language: "both" },
    ).messages.length,
    2,
  );
});
test("Catálogos oficiais cobrem BR/PY e planejamento é por cidade", () => {
  assert.equal(regions.filter((r) => r.country === "BR").length, 27);
  assert.equal(regions.filter((r) => r.country === "PY").length, 18);
  assert.ok(cities.length > 5800);
  const jobs = plan({
    ...campaign,
    scope: "national",
    keywords: ["vendas", "locação"],
  });
  assert.equal(
    jobs.length,
    cities.filter((c) => c.country === "BR").length * 2,
  );
  assert.ok(jobs.every((j) => j.city && j.region));
  assert.throws(() => plan({ ...campaign, cities: ["Cidade inexistente"] }));
});
test("Deduplicação preserva valores e supressão sobrevive à exclusão", async () => {
  const a = await capture(lead, "r1");
  const b = await capture(
    {
      ...lead,
      externalId: "outro",
      name: "Nome mudado",
      website: "https://example.org",
    },
    "r2",
  );
  assert.equal(a.id, b.id);
  assert.equal((await get("CapturedLead", a.id)).name, lead.name);
  assert.equal(
    (await get("CapturedLead", a.id)).website,
    "https://example.org",
  );
  await suppress(a.id, true);
  assert.equal(await get("CapturedLead", a.id), undefined);
  assert.equal(await suppressed(lead), true);
  assert.equal((await capture(lead, "r3")).blocked, true);
  assert.notDeepEqual(identities(lead), identities({ ...lead, demo: true }));
});
test("Análise bloqueia SSRF e exige permissão de domínio", async () => {
  for (const ip of [
    "127.0.0.1",
    "10.0.0.2",
    "172.16.1.1",
    "192.168.1.1",
    "169.254.169.254",
    "::1",
  ])
    assert.equal(publicIP(ip), false);
  assert.equal(publicIP("8.8.8.8"), true);
  const a = await analyzeWebsite("https://example.com", "BR");
  assert.equal(a.status, "permissao_pendente");
});
test("Google Places usa API oficial, máscaras e paginação sem dados inventados", async () => {
  const original = globalThis.fetch;
  const requests: any[] = [];
  globalThis.fetch = (async (url: any, init: any) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith("searchText"))
      return new Response(
        JSON.stringify({
          places: [{ id: "place-1" }],
          nextPageToken: "page-2",
        }),
        { status: 200 },
      );
    return new Response(
      JSON.stringify({
        id: "place-1",
        displayName: { text: "Empresa real da resposta de teste" },
        addressComponents: [
          { types: ["country"], shortText: "PY" },
          { types: ["locality"], longText: "Ciudad del Este" },
          { types: ["administrative_area_level_1"], longText: "Alto Paraná" },
        ],
      }),
      { status: 200 },
    );
  }) as typeof fetch;
  try {
    const p = new GooglePlacesProvider(
      async (_kind, _cost, call) => call(),
      "test-key",
    );
    const r = await p.searchCompanies({
      country: "PY",
      region: "Alto Paraná",
      city: "Ciudad del Este",
      segment: "transportadoras",
      keyword: "carga",
      language: "es",
    });
    assert.equal(r[0].externalId, "place-1");
    assert.equal(p.nextPageToken, "page-2");
    const l = await p.getCompanyDetails("place-1");
    assert.equal(l.country, "PY");
    assert.equal(l.phone, undefined);
    assert.equal(l.whatsapp, undefined);
    assert.equal(l.demo, false);
    assert.match(requests[0].url, /places.googleapis.com/);
    assert.equal(requests[0].init.headers["X-Goog-Api-Key"], "test-key");
    assert.equal(JSON.parse(requests[0].init.body).pageSize, 20);
  } finally {
    globalThis.fetch = original;
  }
});
test("Fluxo completo de demonstração persiste, qualifica e deduplica", async () => {
  await put("Campaign", campaign.id, campaign);
  const r = await createRun(campaign.id);
  await execute(r.id, { provider: new DemoProvider() });
  const done = await getRun(r.id);
  assert.equal(done.status, "concluída");
  assert.equal(done.newLeads, 6);
  assert.equal(done.qualified, 6);
  assert.equal(done.cost, 0);
  const next = await createRun(campaign.id);
  await execute(next.id, { provider: new DemoProvider() });
  assert.equal((await getRun(next.id)).duplicates, 6);
  assert.equal((await getRun(next.id)).newLeads, 0);
});
test("Cancelamento impede captação", async () => {
  const c = { ...campaign, id: "cancel" };
  await put("Campaign", c.id, c);
  const r = await createRun(c.id);
  await updateRun(r.id, { control: "cancelled" });
  await execute(r.id, { provider: new DemoProvider() });
  assert.equal((await getRun(r.id)).status, "cancelada");
  assert.equal((await getRun(r.id)).found, 0);
});
test("Categoria ausente não recebe pontuação de segmento confirmado", () => {
  const q = qualify(
    { ...lead, category: undefined },
    { status: "x", evidence: [] },
    campaign,
  );
  assert.match(
    q.evidence.find((e) => e.check === "segment")!.finding,
    /ainda exige validação/,
  );
});
test("Limite financeiro é reservado antes de enviar consulta real", async () => {
  const { config } = await import("../src/config.js");
  const oldKey = config.key;
  const oldAuth = process.env.GOOGLE_PLACES_CRM_STORAGE_AUTHORIZED;
  const original = globalThis.fetch;
  let calls = 0;
  config.key = "test";
  process.env.GOOGLE_PLACES_CRM_STORAGE_AUTHORIZED = "true";
  globalThis.fetch = (async () => {
    calls++;
    throw Error("Não deveria consultar");
  }) as typeof fetch;
  try {
    const c = { ...campaign, id: "budget", maxCost: 0.001 };
    await put("Campaign", c.id, c);
    const r = await createRun(c.id);
    await execute(r.id);
    assert.equal(calls, 0);
    assert.equal((await getRun(r.id)).status, "concluída parcialmente");
    assert.equal((await getRun(r.id)).requests, 0);
  } finally {
    config.key = oldKey;
    globalThis.fetch = original;
    if (oldAuth === undefined)
      delete process.env.GOOGLE_PLACES_CRM_STORAGE_AUTHORIZED;
    else process.env.GOOGLE_PLACES_CRM_STORAGE_AUTHORIZED = oldAuth;
  }
});
test("Falha de chave real nunca troca silenciosamente para demonstração", async () => {
  const { config } = await import("../src/config.js");
  const oldKey = config.key;
  const oldAuth = process.env.GOOGLE_PLACES_CRM_STORAGE_AUTHORIZED;
  const original = globalThis.fetch;
  config.key = "invalid-test";
  process.env.GOOGLE_PLACES_CRM_STORAGE_AUTHORIZED = "true";
  globalThis.fetch = (async () =>
    new Response("{}", { status: 403 })) as typeof fetch;
  try {
    const c = { ...campaign, id: "invalid-key" };
    await put("Campaign", c.id, c);
    const r = await createRun(c.id);
    await assert.rejects(() => execute(r.id), /403/);
    assert.equal((await getRun(r.id)).status, "falhou");
    assert.equal((await getRun(r.id)).newLeads, 0);
    assert.equal((await getRun(r.id)).demo, false);
    assert.equal((await getRun(r.id)).requests, 1);
    assert.equal((await getRun(r.id)).cost, config.searchCost);
  } finally {
    config.key = oldKey;
    globalThis.fetch = original;
    if (oldAuth === undefined)
      delete process.env.GOOGLE_PLACES_CRM_STORAGE_AUTHORIZED;
    else process.env.GOOGLE_PLACES_CRM_STORAGE_AUTHORIZED = oldAuth;
  }
});
test("Renderização móvel detecta largura fixa sem executar scripts externos", async () => {
  const { renderMobile } = await import("../src/mobile.js");
  const fits = await renderMobile(
    '<html><body><main>Empresa</main><script>throw Error("não executar")</script></body></html>',
    ["body{margin:0}main{width:100%}"],
  );
  assert.equal(fits.fits, true);
  const overflow = await renderMobile(
    "<html><body><main>Empresa</main></body></html>",
    ["main{width:1200px}"],
  );
  assert.equal(overflow.fits, false);
});

test("Transação reverte alterações e leituras concorrentes não veem dados intermediários", async () => {
  const { transaction } = await import("../src/db.js");
  await assert.rejects(
    () =>
      transaction(async () => {
        await put("Campaign", "rollback", { id: "rollback" });
        throw Error("rollback-test");
      }),
    /rollback-test/,
  );
  assert.equal(await get("Campaign", "rollback"), undefined);
  let release!: () => void;
  let entered!: () => void;
  const pending = new Promise<void>((resolve) => (release = resolve));
  const ready = new Promise<void>((resolve) => (entered = resolve));
  const writing = transaction(async () => {
    await put("Campaign", "isolation", { id: "isolation", value: "partial" });
    entered();
    await pending;
    await put("Campaign", "isolation", { id: "isolation", value: "committed" });
  });
  await ready;
  let readCompleted = false;
  const reading = get("Campaign", "isolation").then((row) => {
    readCompleted = true;
    return row;
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(readCompleted, false);
  release();
  await writing;
  assert.equal((await reading).value, "committed");
});
