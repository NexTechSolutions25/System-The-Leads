import { readFileSync } from "node:fs";
import { put, putMany, transaction } from "./db.js";
import { normalize } from "./normalize.js";
import type { Campaign, CountryCode, LeadSearchInput } from "./types.js";
export interface City {
  id: string;
  name: string;
  region: string;
  code: string;
  country: CountryCode;
}
const read = (file: string) =>
  JSON.parse(
    readFileSync(new URL(file, import.meta.url), "utf8").replace(/^\uFEFF/, ""),
  );
export const cities: City[] = [
  ...read("./br-municipios.json").map((x: any) => ({ ...x, country: "BR" })),
  ...read("./py-distritos.json").map((x: any) => ({ ...x, country: "PY" })),
];
export const regions = [
  ...new Map(
    cities.map((c) => [
      c.country + c.code,
      {
        id: c.country + "-" + c.code,
        code: c.code,
        name: c.region,
        country: c.country,
      },
    ]),
  ).values(),
].sort((a, b) => a.name.localeCompare(b.name));
export async function seedGeo() {
  await transaction(async () => {
    for (const c of [
      { id: "BR", name: "Brasil", language: "pt-BR", dial: "+55" },
      { id: "PY", name: "Paraguay", language: "es", dial: "+595" },
    ])
      await put("Country", c.id, c);
    await putMany("Region", regions.map(r => ({ id: r.id, data: r })));
    await putMany("City", cities.map(c => ({ id: c.country + "-" + c.id, data: c })));
    await put("LeadProvider", "google_places", {
      id: "google_places",
      countries: ["BR", "PY"],
    });
    await put("ProviderCredential", "google_places", {
      id: "google_places",
      source: "environment",
      variable: "GOOGLE_PLACES_API_KEY",
    });
  });
}
export function campaignCities(c: Campaign) {
  let list = cities.filter((x) => x.country === c.country);
  if (c.scope !== "national")
    list = list.filter(
      (x) => normalize(x.region) === normalize(c.region) || x.code === c.region,
    );
  if (["city", "custom"].includes(c.scope)) {
    const wanted = c.cities.map(normalize);
    list = list.filter((x) => wanted.includes(normalize(x.name)));
    if (list.length !== new Set(wanted).size)
      throw Error("Uma ou mais cidades não pertencem à região selecionada");
  }
  if (!list.length) throw Error("Nenhuma cidade válida selecionada");
  return list;
}
export function plan(c: Campaign): LeadSearchInput[] {
  return campaignCities(c).flatMap((city) =>
    (c.keywords.length ? c.keywords : [""]).map((keyword) => ({
      country: c.country,
      region: city.region,
      city: city.name,
      segment: c.segment,
      keyword,
      language: c.language,
    })),
  );
}
