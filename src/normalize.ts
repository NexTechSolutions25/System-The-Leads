import { createHash } from "node:crypto";
import { parsePhoneNumberFromString } from "libphonenumber-js";
import type { ExternalLead, CountryCode } from "./types.js";
export const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
export function phone(value: string | undefined, country: CountryCode) {
  if (!value) return undefined;
  const p = parsePhoneNumberFromString(value, country);
  return p?.isValid() ? p.number : undefined;
}
export function domain(value: string | undefined) {
  try {
    return value
      ? new URL(value).hostname.toLowerCase().replace(/^www\./, "")
      : "";
  } catch {
    return "";
  }
}
export function safeUrl(value: unknown) {
  if (typeof value !== "string") return undefined;
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : undefined;
  } catch {
    return undefined;
  }
}
export function identities(l: ExternalLead) {
  const scope = l.demo ? "demo" : "real";
  const values = [`provider:${l.provider}:${l.externalId}`];
  for (const p of [l.phone, l.whatsapp]) if (p) values.push("phone:" + p);
  if (l.email) values.push("email:" + l.email.toLowerCase());
  const n = normalize(l.name);
  const loc = l.country + ":" + normalize(l.city);
  if (l.website) values.push("site:" + domain(l.website) + ":" + loc);
  if (l.address)
    values.push("address:" + n + ":" + loc + ":" + normalize(l.address));
  if (n) values.push("name:" + n + ":" + loc);
  if (l.latitude !== undefined && l.longitude !== undefined)
    values.push(
      "geo:" + n + ":" + l.latitude.toFixed(3) + ":" + l.longitude.toFixed(3),
    );
  return [...new Set(values)].map((v) =>
    createHash("sha256")
      .update(scope + ":" + v)
      .digest("hex"),
  );
}
export function whatsappLink(l: ExternalLead, message: string) {
  if (l.demo) throw Error("Empresas de demonstração não possuem contato real");
  if (!l.whatsapp) throw Error("WhatsApp não identificado publicamente");
  const n = phone(l.whatsapp, l.country);
  if (!n) throw Error("WhatsApp inválido");
  return (
    "https://wa.me/" +
    n.replace(/\D/g, "") +
    "?text=" +
    encodeURIComponent(message)
  );
}
