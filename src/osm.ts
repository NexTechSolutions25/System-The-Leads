import { phone, safeUrl, normalize } from "./normalize.js";
import { now } from "./config.js";
import { regions } from "./geography.js";
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
  constructor(private meter: Meter) {}
  async searchCompanies(i: LeadSearchInput) {
    const query = osmQuery(i);
    const cached = await get("AppMeta", "osm-cache");
    if (cached?.query === query && cached.until > Date.now()) {
      for (const l of cached.rows) this.records.set(l.externalId, l);
      return cached.rows as ExternalLead[];
    }
    const d = await this.meter("search", 0, async () => {
      await transaction(async () => {
        const limit = await get("AppMeta", "osm-rate");
        if (limit?.until > Date.now())
          throw Error(
            "Este painel limita a fonte gratuita a uma busca por minuto. Aguarde e tente novamente.",
          );
        await put("AppMeta", "osm-rate", {
          id: "osm-rate",
          until: Date.now() + 60000,
        });
      });
      const url = new URL("https://overpass.private.coffee/api/interpreter");
      url.searchParams.set("data", query);
      const r = await fetch(url, {
        headers: {
          "User-Agent":
            "NexTech-Leads/1.0 (+https://github.com/NexTechSolutions25/System-The-Leads)",
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(40000),
      }).catch(() => {
        throw Error(
          "A fonte gratuita não respondeu a tempo. Tente novamente mais tarde.",
        );
      });
      if (!r.ok)
        throw Error(
          `Fonte gratuita indisponível (HTTP ${r.status}). Tente novamente mais tarde.`,
        );
      const reader = r.body?.getReader();
      if (!reader) throw Error("Resposta vazia da fonte gratuita");
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 8000000) {
          await reader.cancel();
          throw Error("Resposta grande demais; refine a busca.");
        }
        chunks.push(value);
      }
      const result = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (result.remark)
        throw Error(
          "A fonte gratuita não concluiu a consulta. Tente novamente mais tarde.",
        );
      return result;
    });
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
