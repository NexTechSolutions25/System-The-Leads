import { phone, safeUrl, normalize } from "./normalize.js";
import { now, sleep } from "./config.js";
import { regions, cities } from "./geography.js";
import { get, put, transaction } from "./db.js";
import type { Meter } from "./providers.js";
import type { LeadProvider, LeadSearchInput, ExternalLead } from "./types.js";
const quote = (s: string) => JSON.stringify(s);
const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function osmQuery(i: LeadSearchInput) {
  const segment = normalize(i.segment);
  const rules: [RegExp, string][] = [
    [/convenien|minimerc|despensa/, '["shop"="convenience"]'],
    [/bebida|distribuidora|licorer|adega/, '["shop"~"^(beverages|alcohol)$"]'],
    [/supermerc|mercado/, '["shop"~"^(supermarket|convenience)$"]'],
    [/restaur|comida/, '["amenity"~"^(restaurant|fast_food)$"]'],
    [/padaria|panader/, '["shop"="bakery"]'],
    [/farmacia/, '["amenity"="pharmacy"]'],
    [/imobiliar|inmobiliar/, '["office"="estate_agent"]'],
    [/oficina|mecanica|taller/, '["shop"="car_repair"]'],
    [/hotel|pousada/, '["tourism"~"^(hotel|guest_house|motel)$"]'],
    [/barbear|cabeleir|peluquer/, '["shop"="hairdresser"]'],
    [/posto|combust/, '["amenity"="fuel"]'],
  ];
  const filter = rules.find(([r]) => r.test(segment))?.[1];
  const keyword = i.keyword.trim()
    ? `["name"~${quote(escapeRegex(i.keyword.trim()))},i]`
    : "";
  const selector = filter
    ? filter + keyword
    : `[~"^(shop|office|craft|amenity|tourism)$"~"."]["name"~${quote(escapeRegex(i.segment.trim()))},i]${keyword}`;
  const region = regions.find(
    (r) => r.country === i.country && normalize(r.name) === normalize(i.region),
  );
  const regionQuery =
    i.country === "BR" && region
      ? 'area["ISO3166-2"=' + quote("BR-" + region.code) + "]->.region;"
      : 'area["ISO3166-1"=' +
        quote(i.country) +
        ']["admin_level"="2"]->.country;rel(area.country)["boundary"="administrative"]["admin_level"="4"]["name"~' +
        quote("^" + escapeRegex(i.region) + "$") +
        ",i];map_to_area->.region;";
  const municipality = cities.find(
    (c) =>
      c.country === i.country &&
      normalize(c.region) === normalize(i.region) &&
      normalize(c.name) === normalize(i.city),
  );
  if (i.country === "BR" && municipality)
    return `[out:json][timeout:25][maxsize:16777216];
area["IBGE:GEOCODIGO"=${quote(municipality.id)}]["admin_level"="8"]->.city;
.city out tags;
nwr(area.city)["name"]${selector};out center tags 100;`;
  return `[out:json][timeout:25][maxsize:16777216];
${regionQuery}
rel(area.region)["boundary"="administrative"]["admin_level"~"^(6|7|8|9)$"]["name"~${quote("^" + escapeRegex(i.city) + "$")},i];map_to_area->.city;
.city out tags;
nwr(area.city)["name"]${selector};out center tags 100;`;
}
function whatsapp(value: string | undefined, country: "BR" | "PY") {
  if (!value) return undefined;
  if (/^https?:/i.test(value)) {
    try {
      const u = new URL(value);
      if (u.hostname === "wa.me") value = "+" + u.pathname.slice(1);
      else if (["api.whatsapp.com", "web.whatsapp.com"].includes(u.hostname))
        value = "+" + (u.searchParams.get("phone") || "");
      else return undefined;
    } catch {
      return undefined;
    }
  }
  return phone(value, country);
}
export function osmLead(e: any, i: LeadSearchInput): ExternalLead | undefined {
  const t = e.tags || {};
  if (
    !["node", "way", "relation"].includes(e.type) ||
    !Number.isSafeInteger(e.id) ||
    typeof t.name !== "string" ||
    !t.name.trim() ||
    !["shop", "office", "craft", "amenity", "tourism"].some((k) => t[k])
  )
    return;
  const tel = String(
    t["contact:phone"] || t.phone || t["contact:mobile"] || t.mobile || "",
  ).split(";")[0];
  const address = [t["addr:street"], t["addr:housenumber"], t["addr:suburb"]]
    .filter(Boolean)
    .join(", ");
  return {
    externalId: e.type + "/" + e.id,
    provider: "openstreetmap",
    name: t.name,
    country: i.country,
    region: i.region,
    city: i.city,
    address: address || undefined,
    category: t.shop || t.office || t.craft || t.amenity || t.tourism,
    phone: phone(tel, i.country),
    whatsapp: whatsapp(t["contact:whatsapp"] || t.whatsapp, i.country),
    website: safeUrl(t["contact:website"] || t.website),
    latitude: e.lat ?? e.center?.lat,
    longitude: e.lon ?? e.center?.lon,
    sourceUrl: "https://www.openstreetmap.org/" + e.type + "/" + e.id,
    attributions: [
      {
        displayName: "© OpenStreetMap contributors",
        license: "ODbL",
        url: "https://www.openstreetmap.org/copyright",
      },
    ],
    collectedAt: now(),
    demo: false,
  };
}
export class OpenStreetMapProvider implements LeadProvider {
  name = "openstreetmap";
  supportedCountries = ["BR", "PY"];
  nextPageToken = undefined;
  private records = new Map<string, ExternalLead>();
  constructor(
    private meter: Meter,
    private wait: (ms: number) => Promise<unknown> = sleep,
  ) {}
  async searchCompanies(i: LeadSearchInput) {
    const query = osmQuery(i);
    const cached = await get("AppMeta", "osm-cache");
    if (cached?.query === query && cached.until > Date.now()) {
      for (const l of cached.rows) this.records.set(l.externalId, l);
      return cached.rows as ExternalLead[];
    }
    const endpoints = [
      "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
      "https://overpass.private.coffee/api/interpreter",
    ];
    let d: any;
    for (let attempt = 0; attempt < endpoints.length; attempt++) {
      // Reserve a slot atomically; a second campaign waits instead of failing.
      const delay = await transaction(async () => {
        const limit = await get("AppMeta", "osm-rate");
        const start = Math.max(Date.now(), Number(limit?.until) || 0);
        await put("AppMeta", "osm-rate", {
          id: "osm-rate",
          until: start + 60000,
        });
        return Math.max(0, start - Date.now());
      });
      if (delay) await this.wait(delay);
      try {
        d = await this.meter("search", 0, async () => {
          const transient = (message: string) =>
            Object.assign(new Error(message), { sourceUnavailable: true });
          const url = new URL(endpoints[attempt]);
          url.searchParams.set("data", query);
          const r = await fetch(url, {
            headers: {
              "User-Agent":
                "NexTech-Leads/1.0 (+https://github.com/NexTechSolutions25/System-The-Leads)",
              Accept: "application/json",
            },
            signal: AbortSignal.timeout(40000),
          }).catch(() => {
            throw transient(
              "A fonte gratuita não respondeu. Tente novamente em alguns minutos.",
            );
          });
          if (!r.ok) {
            await r.body?.cancel();
            const message =
              "Fonte gratuita indisponível (HTTP " +
              r.status +
              "). Tente novamente em alguns minutos.";
            // Do not switch servers to get around access restrictions or quotas.
            if ([502, 503, 504].includes(r.status)) throw transient(message);
            throw Error(message);
          }
          const reader = r.body?.getReader();
          if (!reader)
            throw transient("A fonte gratuita retornou uma resposta vazia.");
          const chunks: Uint8Array[] = [];
          let size = 0;
          while (true) {
            const { done, value } = await reader.read().catch(() => {
              throw transient("A conexão com a fonte foi interrompida.");
            });
            if (done) break;
            size += value.length;
            if (size > 8000000) {
              await reader.cancel();
              throw Error("Resposta grande demais; refine a busca.");
            }
            chunks.push(value);
          }
          let result: any;
          try {
            result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            throw Error("A fonte gratuita retornou uma resposta inválida.");
          }
          if (result.remark) {
            if (/timed? ?out|timeout/i.test(result.remark))
              throw transient(
                "A fonte gratuita não concluiu a consulta a tempo.",
              );
            throw Error(
              "A fonte gratuita não concluiu a consulta. Refine a busca.",
            );
          }
          return result;
        });
        break;
      } catch (error) {
        if (
          !(error as any)?.sourceUnavailable ||
          attempt === endpoints.length - 1
        )
          throw error;
      }
    }
    if (!Array.isArray(d.elements))
      throw Error("Resposta inválida da fonte gratuita");
    if (!d.elements.some((e: any) => e.type === "area"))
      throw Error(
        "Município não localizado na fonte gratuita. Confira cidade e estado; a cobertura pode ser limitada.",
      );
    const rows = d.elements
      .map((e: any) => osmLead(e, i))
      .filter(Boolean) as ExternalLead[];
    await put("AppMeta", "osm-cache", {
      id: "osm-cache",
      query,
      until: Date.now() + 86400000,
      rows,
    });
    for (const l of rows) this.records.set(l.externalId, l);
    return rows;
  }
  async getCompanyDetails(id: string) {
    const l = this.records.get(id);
    if (!l) throw Error("Empresa não encontrada na resposta original");
    return l;
  }
}
