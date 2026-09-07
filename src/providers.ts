import { OpenStreetMapProvider } from "./osm.js";
import { createHash } from "node:crypto";
import { config, now } from "./config.js";
import { phone, safeUrl } from "./normalize.js";
import type {
  LeadProvider,
  LeadSearchInput,
  ExternalLead,
  ExternalLeadDetails,
  CountryCode,
} from "./types.js";
export type Meter = (
  kind: "search" | "details",
  cost: number,
  call: () => Promise<any>,
) => Promise<any>;
export class GooglePlacesProvider implements LeadProvider {
  name = "google_places";
  supportedCountries = ["BR", "PY"];
  nextPageToken?: string;
  constructor(
    private meter: Meter,
    private key = config.key,
  ) {}
  private async call(path: string, fields: string, body?: unknown) {
    const r = await fetch("https://places.googleapis.com/v1/" + path, {
      method: body ? "POST" : "GET",
      headers: {
        "X-Goog-Api-Key": this.key,
        "X-Goog-FieldMask": fields,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) {
      const e: any = Error(`Google Places HTTP ${r.status}`);
      e.retryable = r.status === 429 || r.status >= 500;
      throw e;
    }
    return r.json();
  }
  async searchCompanies(i: LeadSearchInput) {
    const d = await this.meter("search", config.searchCost, () =>
      this.call("places:searchText", "places.id,nextPageToken", {
        textQuery: [
          i.segment,
          i.keyword,
          i.city,
          i.region,
          i.country === "BR" ? "Brasil" : "Paraguay",
        ]
          .filter(Boolean)
          .join(" "),
        regionCode: i.country,
        languageCode: i.language === "es" ? "es" : "pt-BR",
        pageSize: 20,
        ...(i.pageToken ? { pageToken: i.pageToken } : {}),
      }),
    );
    this.nextPageToken = d.nextPageToken;
    return (d.places || []).map((p: any) => ({
      externalId: p.id,
      provider: this.name,
      name: "",
      country: i.country,
      region: i.region,
      city: i.city,
      segment: i.segment,
      collectedAt: now(),
      demo: false,
    }));
  }
  async getCompanyDetails(id: string): Promise<ExternalLeadDetails> {
    const p = await this.meter("details", config.detailsCost, () =>
      this.call(
        "places/" + encodeURIComponent(id),
        "id,displayName,primaryTypeDisplayName,formattedAddress,addressComponents,location,internationalPhoneNumber,websiteUri,regularOpeningHours,rating,userRatingCount,googleMapsUri,attributions",
      ),
    );
    const part = (type: string, short = false) => {
      const x = p.addressComponents?.find((a: any) => a.types.includes(type));
      return x?.[short ? "shortText" : "longText"] || "";
    };
    const country = part("country", true) as CountryCode;
    if (!this.supportedCountries.includes(country))
      throw Error("Empresa fora dos países suportados");
    return {
      externalId: p.id,
      provider: this.name,
      name: p.displayName?.text || "",
      country,
      region: part("administrative_area_level_1"),
      city: part("locality") || part("administrative_area_level_2"),
      address: p.formattedAddress,
      category: p.primaryTypeDisplayName?.text,
      phone: phone(p.internationalPhoneNumber, country),
      website: safeUrl(p.websiteUri),
      latitude: p.location?.latitude,
      longitude: p.location?.longitude,
      hours: p.regularOpeningHours?.weekdayDescriptions,
      rating: p.rating,
      reviewCount: p.userRatingCount,
      sourceUrl: safeUrl(p.googleMapsUri),
      attributions: p.attributions,
      collectedAt: now(),
      demo: false,
    };
  }
}
export class DemoProvider implements LeadProvider {
  name = "demonstration";
  supportedCountries = ["BR", "PY"];
  nextPageToken = undefined;
  private records = new Map<string, ExternalLead>();
  async searchCompanies(i: LeadSearchInput) {
    const rows = Array.from({ length: 6 }, (_, n) => {
      const externalId = createHash("sha256")
        .update([i.country, i.city, i.segment, n].join(":"))
        .digest("hex")
        .slice(0, 20);
      const l: ExternalLead = {
        externalId,
        provider: this.name,
        name: `Empresa Fictícia ${n + 1} — ${i.segment}`,
        country: i.country,
        region: i.region,
        city: i.city,
        category: i.segment,
        segment: i.segment,
        address: `Endereço fictício ${n + 1}`,
        description: "Registro sintético, sem contato real.",
        collectedAt: now(),
        demo: true,
      };
      this.records.set(externalId, l);
      return l;
    });
    return rows;
  }
  async getCompanyDetails(id: string) {
    const r = this.records.get(id);
    if (!r) throw Error("Registro de demonstração indisponível");
    return r;
  }
}
// A new licensed provider implements this interface and is registered here.
export function provider(meter: Meter): LeadProvider {
  if (config.freeMode || config.provider === "openstreetmap") return new OpenStreetMapProvider(meter);
  if (!config.key) return new DemoProvider();
  if (config.provider !== "google_places")
    throw Error("Provedor não registrado");
  if (process.env.GOOGLE_PLACES_CRM_STORAGE_AUTHORIZED !== "true")
    throw Error(
      "Google Places: confirme direitos contratuais de armazenamento/uso em CRM antes de ativar GOOGLE_PLACES_CRM_STORAGE_AUTHORIZED. Uma chave de API não concede esses direitos.",
    );
  return new GooglePlacesProvider(meter);
}
