import { normalize } from "./normalize.js";
import { now } from "./config.js";
import type {
  ExternalLead,
  Analysis,
  Campaign,
  Qualification,
} from "./types.js";
export function qualify(
  l: ExternalLead,
  a: Analysis,
  c: Campaign,
): Qualification {
  const evidence = [...a.evidence];
  let score = 0;
  const add = (n: number, check: string, finding: string) => {
    score += n;
    evidence.push({
      check,
      finding: `${finding} (${n >= 0 ? "+" : ""}${n} pontos)`,
      at: now(),
      url: l.sourceUrl,
    });
  };
  const category = normalize(l.category || "");
  const requested = normalize(c.segment);
  const segment =
    !!category &&
    (category.includes(requested) || requested.includes(category));
  add(
    segment ? 20 : 8,
    "segment",
    segment
      ? "Categoria compatível com segmento"
      : "Empresa retornada pela consulta; segmento ainda exige validação",
  );
  add(
    l.country === c.country ? 15 : 0,
    "location",
    "País validado no retorno da fonte",
  );
  if (l.phone || l.whatsapp || l.email)
    add(20, "contact", "Contato comercial disponível");
  if (l.website) add(5, "website", "Site informado pelo provedor");
  else add(5, "website", "Site não informado; ausência não comprovada");
  if (a.status === "analisado") {
    add(5, "analysis", "Análise pública com evidências");
    if (a.https === false) add(8, "opportunity", "HTTP observado");
    if (a.cta === false)
      add(
        8,
        "opportunity",
        "Chamada para ação não encontrada na página analisada",
      );
    if (a.description === undefined || a.description === "")
      add(4, "opportunity", "Descrição da página não encontrada");
  }
  const fields = [
    l.name,
    l.category,
    l.country,
    l.region,
    l.city,
    l.address,
    l.phone || l.whatsapp || l.email,
    l.website,
    l.sourceUrl,
    l.collectedAt,
  ];
  const completeness = Math.round(
    (fields.filter(Boolean).length / fields.length) * 100,
  );
  add(
    Math.round(completeness * 0.15),
    "completeness",
    `Completude de ${completeness}%`,
  );
  const opportunity =
    a.status === "analisado" && a.cta === false
      ? "Avaliar uma chamada para ação mais clara na página analisada."
      : !l.website
        ? "Verificar com a empresa se existe site e se há interesse em presença digital."
        : "Validar necessidades de organização comercial e integração de sistemas em conversa.";
  add(
    5,
    "fit",
    "Serviço oferecido selecionado na campanha; interesse ainda não confirmado",
  );
  score = Math.max(0, Math.min(100, score));
  if (!(l.phone || l.whatsapp || l.email)) score = Math.min(59, score);
  const messages = [];
  if (c.language !== "es")
    messages.push({
      language: "pt-BR",
      text: `Olá, equipe da ${l.name}! Trabalho com soluções digitais para empresas e gostaria de entender como vocês organizam a presença online e os atendimentos. Podemos conversar brevemente sobre ${c.service}? Se não fizer sentido, é só me avisar.`,
    });
  const esServices: Record<string, string> = {
    "site institucional": "sitios web institucionales",
    "landing page": "páginas de presentación",
    "catálogo digital": "catálogos digitales",
    "sistema de gestão": "sistemas de gestión",
    CRM: "gestión de relaciones con clientes",
    "sistema sob medida": "sistemas a medida",
    "automação de atendimento": "automatización de atención al cliente",
    "automação comercial": "automatización comercial",
    "integração entre sistemas": "integración de sistemas",
    "site integrado a um painel administrativo":
      "sitios web con panel de administración",
  };
  if (c.language !== "pt-BR")
    messages.push({
      language: "es",
      text: `Hola, equipo de ${l.name}. Trabajo con soluciones digitales para empresas y me gustaría conocer cómo gestionan su presencia en internet y las consultas de sus clientes. ¿Podemos conversar brevemente sobre ${esServices[c.service] || "una solución digital para su empresa"}? Si no les interesa, me avisan y no vuelvo a contactarles.`,
    });
  return {
    score,
    priority:
      score < 40
        ? "baixa"
        : score < 70
          ? "média"
          : score < 85
            ? "alta"
            : "excelente",
    completeness,
    opportunity,
    evidence,
    service: c.service,
    rationale:
      "Pontuação explicável pelas evidências; não estima intenção de compra nem comprova problemas não observados.",
    messages,
    questions:
      c.language === "es"
        ? [
            "¿Cómo gestionan hoy las consultas de clientes?",
            "¿Qué tarea les gustaría simplificar?",
            "¿Quién evalúa mejoras digitales en la empresa?",
          ]
        : [
            "Como organizam os contatos de clientes hoje?",
            "Qual tarefa gostariam de simplificar?",
            "Quem avalia melhorias digitais na empresa?",
          ],
    language: c.language,
  };
}
