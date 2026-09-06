import { load } from "cheerio";
import { createRequire } from "node:module";
const robotsParser = createRequire(import.meta.url)("robots-parser") as any;
import { lookup } from "node:dns/promises";
import https from "node:https";
import http from "node:http";
import { isIP } from "node:net";
import { config, now, sleep } from "./config.js";
import { phone } from "./normalize.js";
import { renderMobile } from "./mobile.js";
import type { Analysis, CountryCode } from "./types.js";
export function publicIP(ip: string) {
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  return false;
}
async function request(url: string): Promise<{
  status: number;
  text: string;
  type: string;
  headers: http.IncomingHttpHeaders;
}> {
  const u = new URL(url);
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    (u.port && !["80", "443"].includes(u.port))
  )
    throw Error("URL não permitida");
  const addresses = await lookup(u.hostname, { all: true });
  if (!addresses.length || addresses.some((x) => !publicIP(x.address)))
    throw Error("Endereço não público ou IPv6 não permitido");
  const address = addresses[0].address;
  return new Promise((resolve, reject) => {
    const req = (u.protocol === "https:" ? https : http).get(
      u,
      {
        headers: {
          "User-Agent": "NexTechLeadAudit/1.0",
          Accept: "text/html,text/plain",
        },
        lookup: (_host, _opts, cb: any) => cb(null, address, 4),
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > 1024 * 1024) {
            req.destroy(Error("Página maior que 1 MB"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({
            status: res.statusCode || 0,
            text: Buffer.concat(chunks).toString("utf8"),
            type: String(res.headers["content-type"] || ""),
            headers: res.headers,
          }),
        );
        res.on("error", reject);
      },
    );
    const timer = setTimeout(() => req.destroy(Error("Timeout total")), 12000);
    req.on("close", () => clearTimeout(timer));
    req.setTimeout(10000, () => req.destroy(Error("Timeout")));
    req.on("error", reject);
  });
}
const lastAccess = new Map<string, number>();
async function limited(url: string) {
  const host = new URL(url).host;
  const at = Math.max(
    Date.now(),
    (lastAccess.get(host) || 0) +
      Math.max(1000, Number(process.env.WEBSITE_DELAY_MS || 1500)),
  );
  lastAccess.set(host, at);
  await sleep(Math.max(0, at - Date.now()));
  return request(url);
}
export async function analyzeWebsite(
  url: string | undefined,
  country: CountryCode,
): Promise<Analysis> {
  const a: Analysis = { status: "sem_site_informado", evidence: [] };
  const evidence = (check: string, finding: string, u = url) =>
    a.evidence.push({ check, finding, url: u, at: now() });
  if (!url) {
    evidence(
      "website",
      "Provedor não informou site; isso não comprova ausência de site.",
    );
    return a;
  }
  try {
    const u = new URL(url);
    if (!config.allowedHosts.includes(u.hostname.toLowerCase())) {
      a.status = "permissao_pendente";
      evidence(
        "permission",
        "Domínio não autorizado em WEBSITE_ALLOWED_HOSTS após revisão dos termos.",
      );
      return a;
    }
    const robotUrl = new URL("/robots.txt", u).href;
    const r = await limited(robotUrl);
    if (r.status !== 200 && r.status !== 404) {
      a.status = "bloqueado";
      evidence(
        "robots",
        "Não foi possível confirmar permissão pelo robots.txt.",
      );
      return a;
    }
    const rules = robotsParser(robotUrl, r.status === 404 ? "" : r.text);
    if (rules.isAllowed(url, "NexTechLeadAudit") === false) {
      a.status = "bloqueado";
      evidence("robots", "robots.txt proíbe análise.");
      return a;
    }
    const delay = rules.getCrawlDelay("NexTechLeadAudit");
    if (delay && delay > 0) await sleep(Math.min(delay * 1000, 60000));
    if (delay && delay > 60) {
      a.status = "bloqueado";
      evidence("robots", "Crawl-delay acima do limite do analisador.");
      return a;
    }
    const start = Date.now();
    const page = await limited(url);
    a.responseMs = Date.now() - start;
    if (page.status >= 300 && page.status < 400) {
      a.status = "redirecionamento";
      evidence(
        "http",
        "Redirecionamento não seguido; destino exige revisão própria.",
      );
      return a;
    }
    if (page.status !== 200 || !page.type.includes("text/html")) {
      a.status = "indisponivel";
      evidence("http", `HTTP ${page.status}; conteúdo ${page.type}`);
      return a;
    }
    const $ = load(page.text);
    a.status = "analisado";
    a.https = u.protocol === "https:";
    a.title = $("title").first().text().trim().slice(0, 300);
    a.description = $('meta[name="description"]')
      .attr("content")
      ?.slice(0, 500);
    a.mobile = !!$('meta[name="viewport"]').length;
    a.contactForm = !!$("form").find("input,textarea").length;
    a.language = $("html").attr("lang");
    const links = $("a[href]")
      .toArray()
      .map((el) => ({
        href: $(el).attr("href") || "",
        text: $(el).text().trim(),
      }));
    a.catalog = links.some((x) =>
      /cat[aá]logo|produtos|productos/i.test(x.href + " " + x.text),
    );
    a.services = links.some((x) =>
      /servi[cç]os|servicios/i.test(x.href + " " + x.text),
    );
    a.cta =
      links.some((x) =>
        /contat|contact|or[cç]amento|presupuesto|fale|cotiza/i.test(x.text),
      ) || a.contactForm;
    a.businessInfo = /CNPJ|RUC|endere[cç]o|direcci[oó]n/i.test(
      $("body").text(),
    );
    a.technologies = [];
    if (/wp-content|wordpress/i.test(page.text))
      a.technologies.push("WordPress");
    if (/__next/i.test(page.text)) a.technologies.push("Next.js");
    if (/shopify/i.test(page.text)) a.technologies.push("Shopify");
    for (const l of links) {
      try {
        const w = new URL(l.href, url);
        if (w.hostname === "wa.me")
          a.whatsapp = phone(w.pathname.slice(1), country);
        if (w.hostname === "api.whatsapp.com")
          a.whatsapp = phone(w.searchParams.get("phone") || "", country);
        if (a.whatsapp) {
          evidence(
            "whatsapp",
            "Número identificado em link público de WhatsApp.",
            w.href,
          );
          break;
        }
      } catch {}
    }
    for (const l of links) {
      try {
        const target = new URL(l.href, url);
        if (target.protocol === "mailto:") {
          const email = decodeURIComponent(target.pathname)
            .trim()
            .toLowerCase();
          if (
            /^(contato|contacto|contact|info|comercial|vendas|ventas|sales|atendimento|administracion|administracao|suporte|support)@[a-z0-9.-]+\.[a-z]{2,}$/i.test(
              email,
            )
          ) {
            a.email = email;
            evidence(
              "public_email",
              "E-mail de função comercial identificado em link público.",
              url,
            );
          }
        }
        if (
          ["instagram.com", "www.instagram.com"].includes(target.hostname) &&
          /^\/[a-zA-Z0-9._]+\/?$/.test(target.pathname)
        ) {
          a.instagram = target.href;
          evidence(
            "instagram",
            "Perfil indicado no site da empresa; plataforma não consultada.",
            target.href,
          );
        }
      } catch {}
    }
    evidence(
      "https",
      a.https ? "HTTPS utilizado." : "Página respondida via HTTP.",
    );
    evidence(
      "mobile",
      a.mobile
        ? "Meta viewport presente; usabilidade móvel não validada por renderização."
        : "Meta viewport não encontrada; usabilidade móvel não verificada.",
    );
    evidence("response", `Resposta aproximada: ${a.responseMs} ms.`);
    evidence(
      "metadata",
      `Título: ${a.title || "não encontrado"}; descrição: ${a.description || "não encontrada"}`,
    );
    evidence(
      "cta",
      a.cta
        ? "Sinal de contato/ação encontrado na página."
        : "Nenhum sinal de contato/ação encontrado nesta página.",
    );
    evidence(
      "public_html",
      `Formulário: ${a.contactForm}; catálogo: ${a.catalog}; serviços: ${a.services}; idioma: ${a.language || "não identificado"}; informações comerciais: ${a.businessInfo}; tecnologias: ${a.technologies.join(", ") || "não identificadas"}.`,
    );
    const cssTexts: string[] = [];
    let cssComplete = true;
    const styleLinks = $('link[rel="stylesheet"][href]').toArray();
    if (styleLinks.length > 3) cssComplete = false;
    for (const el of styleLinks.slice(0, 3)) {
      try {
        const cssUrl = new URL($(el).attr("href") || "", url);
        if (
          cssUrl.origin !== u.origin ||
          rules.isAllowed(cssUrl.href, "NexTechLeadAudit") === false
        ) {
          cssComplete = false;
          continue;
        }
        if (delay) await sleep(delay * 1000);
        const sheet = await limited(cssUrl.href);
        if (sheet.status === 200 && sheet.type.includes("text/css"))
          cssTexts.push(sheet.text);
        else cssComplete = false;
      } catch {
        cssComplete = false;
      }
    }
    if (cssComplete) {
      try {
        const mobile = await renderMobile(page.text, cssTexts);
        a.mobile = mobile.fits;
        evidence(
          "mobile_render",
          `Renderização estática em 390×844: largura do conteúdo ${mobile.width}px; ${mobile.fits ? "sem" : "com"} transbordamento horizontal. Scripts e acessos externos desativados; interações não certificadas.`,
        );
      } catch {
        a.mobile = undefined;
        evidence(
          "mobile_render",
          "Renderização indisponível. Configure BROWSER_EXECUTABLE_PATH ou instale Chromium.",
        );
      }
    } else {
      a.mobile = undefined;
      evidence(
        "mobile_render",
        "CSS externo ou excedente não verificado; funcionamento móvel permanece inconclusivo.",
      );
    }
    a.brokenLinks = [];
    const targets = [
      ...new Set(
        links
          .map((l) => {
            try {
              const v = new URL(l.href, url);
              return v.origin === u.origin &&
                !v.hash &&
                /^https?:$/.test(v.protocol)
                ? v.href
                : "";
            } catch {
              return "";
            }
          })
          .filter(Boolean),
      ),
    ].slice(0, 3);
    for (const target of targets) {
      if (rules.isAllowed(target, "NexTechLeadAudit") === false) continue;
      if (delay) await sleep(delay * 1000);
      try {
        const result = await limited(target);
        if (result.status === 404 || result.status === 410)
          a.brokenLinks.push(target);
      } catch {}
    }
    evidence(
      "links",
      `Amostra de até 3 links internos; ${a.brokenLinks.length} retornaram 404/410.`,
    );
  } catch (e) {
    a.status = "erro";
    evidence("error", (e as Error).message);
  }
  return a;
}
