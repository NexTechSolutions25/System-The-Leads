const $ = (s) => document.querySelector(s);
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let state = { campaigns: [], runs: [], leads: [], schedules: [], status: {} },
  currentLead;
async function api(path, method = "GET", data) {
  const headers = {
    "Content-Type": "application/json",
    "X-NexTech-Request": "1",
  };
  const r = await fetch("/api" + path, {
    method,
    headers,
    body: data ? JSON.stringify(data) : undefined,
  });
  if (r.status === 401) {
    location.replace("/login");
    throw Error("Sessão encerrada");
  }
  const d = await r.json();
  if (!r.ok) throw Error(d.error || "Não foi possível concluir a operação");
  return d;
}
function toast(text) {
  $("#toast").textContent = text;
  $("#toast").classList.remove("hidden");
  setTimeout(() => $("#toast").classList.add("hidden"), 7000);
}
function tab(name) {
  document
    .querySelectorAll(".tab")
    .forEach((el) => el.classList.toggle("hidden", el.id !== name));
  document
    .querySelectorAll("[data-tab]")
    .forEach((el) => el.classList.toggle("active", el.dataset.tab === name));
  $("#page-title").textContent = {
    overview: "Visão geral",
    campaigns: "Campanhas",
    approval: "Fila de aprovação",
    pipeline: "Pipeline",
    settings: "Configuração",
  }[name];
}
const empty = (title, text) =>
  `<div class="empty"><strong>${esc(title)}</strong>${esc(text)}</div>`;
const stamp = (s) => (s ? new Date(s).toLocaleString("pt-BR") : "—");
const badge = (l) =>
  `<span class="badge ${l.demo ? "demo" : ""}">${l.demo ? "DEMONSTRAÇÃO" : esc(l.provider)}</span>`;
function leadCard(item) {
  const l = item.lead,
    q = item.qualification;
  return `<article class="card"><div class="card-top">${badge(l)}<span class="score">${q?.score ?? "—"}<small>/100</small></span></div><h2>${esc(l.name)}</h2><p>${esc(l.city)} · ${esc(l.country)} · ${esc(l.segment)}</p><p>${esc(q?.opportunity || "Qualificação pendente")}</p><div class="actions"><button data-action="lead" data-id="${esc(l.id)}">Revisar empresa ↗</button><span class="badge">${esc(l.doNotContact ? "Não contatar" : item.approval?.status || "Abaixo do corte")}</span></div></article>`;
}
function render() {
  const { campaigns, runs, leads, status } = state;
  const pending = leads.filter(
    (x) => x.approval?.status === "pending" && !x.lead.doNotContact,
  );
  $("#m-leads").textContent = leads.length;
  $("#m-pending").textContent = pending.length;
  $("#pending-count").textContent = pending.length;
  $("#m-pipeline").textContent = leads.filter((x) => x.pipeline).length;
  $("#m-cost").textContent =
    "$" + runs.reduce((n, r) => n + r.cost, 0).toFixed(2);
  $("#mode-banner").textContent = status.message || "Conectando ao servidor…";
  $("#queue-health").textContent = status.redis
    ? "● Redis conectado"
    : "○ Redis desconectado";
  $("#runs").innerHTML = runs.length
    ? runs
        .map((r) => {
          const c = campaigns.find((c) => c.id === r.campaignId) || {};
          const active = ![
            "concluída",
            "concluída parcialmente",
            "falhou",
            "cancelada",
          ].includes(r.status);
          const next = state.schedules.find(
            (s) => s.key === r.campaignId || s.id === r.campaignId,
          );
          return `<article class="run"><div class="run-head"><div><strong>${esc(c.name || r.campaignId)}</strong><small>${esc(c.country)} · ${esc(c.region || "Nacional")} · ${esc(c.segment)} · ${esc(r.provider || "aguardando")}</small></div><span class="chip">${r.control === "paused" ? "pausada · " : ""}${esc(r.status)}</span></div><progress max="100" value="${Number(r.progress) || 0}"></progress><div class="run-metrics"><span>Consultas <b>${r.requests}</b></span><span>Encontradas <b>${r.found}</b></span><span>Novas <b>${r.newLeads}</b></span><span>Duplicadas <b>${r.duplicates}</b></span><span>Qualificadas <b>${r.qualified}</b></span><span>Rejeitadas <b>${r.rejected}</b></span><span>Erros <b>${r.errors.length}</b></span><span>USD <b>$${r.cost.toFixed(2)}</b></span></div><details><summary>Detalhes da execução</summary><p>Início: ${stamp(r.startedAt)} · Duração: ${r.startedAt ? Math.max(0, Math.round(((r.finishedAt ? new Date(r.finishedAt) : Date.now()) - new Date(r.startedAt)) / 1000)) : 0}s · Próxima execução: ${stamp(next?.next)}<br>Cidades pesquisadas: ${esc(r.citiesSearched.join(", ") || "—")}<br>Lotes: ${r.cursor}/${r.totalBatches || "—"} · Motivo de encerramento: ${esc(r.finishReason || "—")}</p>${r.errors.map((e) => `<p class="error">${esc(e.message)}</p>`).join("")}</details><div class="run-actions">${active ? `<button data-action="run-${r.control === "paused" ? "resume" : "pause"}" data-id="${r.id}">${r.control === "paused" ? "Retomar" : "Pausar"}</button><button data-action="run-cancel" data-id="${r.id}">Cancelar</button>` : ""}${r.status === "falhou" ? `<button data-action="run-retry" data-id="${r.id}">Tentar novamente</button>` : ""}</div></article>`;
        })
        .join("")
    : empty(
        "Sua primeira descoberta começa aqui",
        "Crie uma campanha para pesquisar empresas e acompanhar os resultados.",
      );
  $("#campaign-list").innerHTML = campaigns.length
    ? campaigns
        .map(
          (c) =>
            `<article class="card"><div class="card-top"><span class="chip">${esc(c.country)} · ${esc(c.scope)}</span><span class="badge">${c.maxLeads} leads</span></div><h2>${esc(c.name)}</h2><p>${esc(c.region || "Busca nacional")} ${c.cities.length ? "· " + esc(c.cities.join(", ")) : ""}</p><p>${esc(c.segment)} · ${esc(c.service)}</p><p>Corte ${c.minScore} · Máx. ${c.maxRequests} consultas · USD ${c.maxCost.toFixed(2)}</p><p>${c.schedule ? `${esc(c.schedule.frequency)} · ${esc(c.schedule.time)} · ${esc(c.schedule.timezone)} · ${c.scheduling?.active ? "Ativo" : "Inativo"}` : "Execução manual"}</p><div class="actions"><button class="primary" data-action="start" data-id="${c.id}">Iniciar captação</button>${c.schedule ? `<button data-action="${c.scheduling?.active ? "unschedule" : "schedule"}" data-id="${c.id}">${c.scheduling?.active ? "Pausar agenda" : "Ativar agenda"}</button>` : ""}</div></article>`,
        )
        .join("")
    : empty(
        "Nenhuma campanha criada",
        "Defina uma cidade, um segmento e o serviço que deseja oferecer.",
      );
  const filter = $("#approval-filter").value;
  const filtered = leads.filter(
    (l) => filter === "all" || l.approval?.status === filter,
  );
  $("#approval-list").innerHTML = filtered.length
    ? filtered.map(leadCard).join("")
    : empty(
        "Tudo em dia por aqui",
        "Os leads que atingirem a pontuação mínima aparecerão para revisão.",
      );
  const pipeline = leads.filter((l) => l.pipeline);
  $("#pipeline-list").innerHTML = pipeline.length
    ? pipeline.map(leadCard).join("")
    : empty(
        "Seu pipeline está pronto",
        "Aprove um lead e escolha “Transferir para pipeline”.",
      );
  $("#settings-status").innerHTML =
    `<p>Modo: <b>${esc(status.mode)}</b> · Provedor: <b>${esc(status.provider)}</b> · Redis: <b>${status.redis ? "conectado" : "desconectado"}</b></p><p>Chave configurada: ${status.keyConfigured ? "sim" : "não"} · Armazenamento autorizado: ${status.storageAuthorized ? "sim" : "não"}</p><p>Domínios autorizados para análise: ${esc((status.allowedHosts || []).join(", ") || "nenhum")}</p><p>Estimativa por consulta: busca USD ${status.searchCost || 0}; detalhes USD ${status.detailsCost || 0}. Confira os valores de faturamento do seu contrato.</p>`;
}
let refreshing = false;
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const [campaigns, runs, leads, status, schedules] = await Promise.all(
      ["/campaigns", "/runs", "/leads", "/status", "/schedules"].map((p) =>
        api(p),
      ),
    );
    state = { campaigns, runs, leads, status, schedules };
    render();
  } catch (e) {
    $("#mode-banner").textContent = e.message;
  } finally {
    refreshing = false;
  }
}
async function locations() {
  const country = $("#country").value;
  const d = await api("/locations?country=" + country);
  $("#region").innerHTML = d.regions
    .map((r) => `<option value="${esc(r.name)}">${esc(r.name)}</option>`)
    .join("");
  const defaultRegion = country === "BR" ? "Mato Grosso do Sul" : "ALTO PARANA";
  if (d.regions.some((r) => r.name === defaultRegion))
    $("#region").value = defaultRegion;
  await updateCities();
}
async function updateCities() {
  const d = await api(
    "/locations?country=" +
      $("#country").value +
      "&region=" +
      encodeURIComponent($("#region").value),
  );
  $("#city").innerHTML = d.cities
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`)
    .join("");
  const wanted = $("#country").value === "BR" ? "Dourados" : "CIUDAD DEL ESTE";
  if (d.cities.some((c) => c.name === wanted)) $("#city").value = wanted;
}
function scope() {
  const s = $("#scope").value;
  $("#city-label").classList.toggle("hidden", s !== "city");
  $("#custom-label").classList.toggle("hidden", s !== "custom");
  $("#region").disabled = s === "national";
}
async function newCampaign() {
  $("#country").value = state.status.defaultCountry === "PY" ? "PY" : "BR";
  $("#language").value = $("#country").value === "PY" ? "es" : "pt-BR";
  await locations();
  $("#form-error").textContent = "";
  $("#campaign-dialog").showModal();
}
const link = (url, label) => {
  try {
    const u = new URL(url);
    return ["https:", "http:"].includes(u.protocol)
      ? `<a href="${esc(u.href)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`
      : "";
  } catch {
    return "";
  }
};
function openLead(id) {
  currentLead = id;
  const item = state.leads.find((x) => x.lead.id === id);
  if (!item) return;
  const { lead: l, qualification: q, analysis: a, approval: approval } = item;
  const messages = approval?.messages || q?.messages || [];
  $("#lead-detail").innerHTML =
    `<div class="dialog-heading"><div>${badge(l)}<h2>${esc(l.name)}</h2><p>${esc(l.city)} · ${esc(l.country)} · ${esc(l.segment)}</p></div><button class="icon" data-close="lead-dialog" aria-label="Fechar">×</button></div><div class="detail-grid"><div><small>Pontuação e prioridade</small>${q?.score ?? "—"}/100 · ${esc(q?.priority)}</div><div><small>Completude</small>${q?.completeness ?? "—"}%</div><div><small>Telefone público</small>${esc(l.phone || "Não informado")}</div><div><small>WhatsApp identificado</small>${esc(l.whatsapp || "Não identificado")}</div><div><small>E-mail comercial</small>${esc(l.email || "Não informado")}</div><div><small>Fonte · coleta</small>${link(l.sourceUrl, l.provider) || esc(l.provider)} · ${stamp(l.collectedAt)}</div><div><small>Endereço</small>${esc(l.address || "Não informado")}</div><div><small>Análise de site</small>${esc(a?.status || "Pendente")}</div></div><h3>Oportunidade e serviço recomendado</h3><p>${esc(q?.opportunity)} ${esc(q?.service)}</p><p class="note">${esc(q?.rationale)}</p><h3>Evidências</h3><ul class="evidence-list">${(q?.evidence || []).map((e) => `<li>${esc(e.finding)} ${link(e.url, "Fonte")} · ${stamp(e.at)}</li>`).join("")}</ul><h3>Perguntas de qualificação</h3><ul class="evidence-list">${(q?.questions || []).map((e) => `<li>${esc(e)}</li>`).join("")}</ul><h3>Revisar mensagem</h3><p class="note">Edite e salve antes da aprovação. Abrir WhatsApp somente prepara a conversa; o envio é manual.</p>${messages.map((m, i) => `<label>${esc(m.language)}<textarea class="message" data-language="${esc(m.language)}" data-index="${i}">${esc(m.text)}</textarea></label>`).join("")}<div class="detail-actions">${approval ? '<button data-action="save-message">Salvar edição</button>' : ""}<button data-action="copy">Copiar mensagem</button>${link(l.website, "Abrir site")}${link(l.instagram, "Abrir Instagram")}</div><div class="detail-actions">${approval && !l.doNotContact ? '<button class="primary" data-action="approve">Aprovar lead</button><button data-action="reject">Rejeitar</button>' : ""}${approval?.status === "approved" ? '<button data-action="pipeline">Transferir para pipeline</button>' : ""}${approval?.status === "approved" && l.whatsapp && !l.demo ? '<button data-action="whatsapp">Revisar e abrir WhatsApp</button>' : ""}${!l.doNotContact ? '<button data-action="reanalyze">Analisar novamente</button>' : ""}</div><p class="note">Estado: ${esc(approval?.status || "Fora da fila")} ${item.pipeline ? "· No pipeline" : ""}</p>${l.provider === "google_places" ? "<p>Google Maps · " + (l.attributions || []).map((x) => esc(x.displayName || "")).join(" · ") + "</p>" : ""}<div class="privacy"><p class="note">A exclusão remove os dados e preserva apenas hashes para impedir novas captações desta empresa.</p><div class="detail-actions"><button data-action="do_not_contact">Não contatar</button><button data-action="anonymize">Remover dados identificáveis</button><button data-action="delete">Excluir empresa</button></div></div>`;
  if (!$("#lead-dialog").open) $("#lead-dialog").showModal();
}
const editedMessages = () =>
  [...document.querySelectorAll(".message")].map((x) => ({
    language: x.dataset.language,
    text: x.value,
  }));
document.addEventListener("click", async (event) => {
  const el = event.target.closest("button");
  if (!el) return;
  if (el.dataset.tab) return tab(el.dataset.tab);
  if (el.dataset.close) return $("#" + el.dataset.close).close();
  const action = el.dataset.action;
  if (!action) return;
  el.disabled = true;
  try {
    const id = el.dataset.id;
    switch (action) {
      case "new":
        await newCampaign();
        break;
      case "lead":
        openLead(id);
        break;
      case "logout": {
        await fetch("/auth/logout", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-NexTech-Request": "1",
          },
          body: "{}",
        });
        location.replace("/login");
        return;
      }
      case "start":
        await api("/campaigns/" + id + "/run", "POST", {});
        toast("Campanha enviada à fila");
        tab("overview");
        break;
      case "schedule":
        await api("/campaigns/" + id + "/schedule", "POST", {});
        toast("Agenda ativada");
        break;
      case "unschedule":
        await api("/campaigns/" + id + "/schedule", "DELETE");
        toast(
          "Agenda pausada; execuções já iniciadas podem ser canceladas no monitor",
        );
        break;
      case "save-message":
        await api("/leads/" + currentLead + "/messages", "PATCH", {
          messages: editedMessages(),
        });
        toast("Mensagem salva; aprovação pendente");
        break;
      case "copy":
        await navigator.clipboard.writeText(
          editedMessages()
            .map((m) => m.text)
            .join("\n\n"),
        );
        toast("Mensagem copiada");
        break;
      case "approve":
      case "reject":
      case "pipeline":
        if (action === "approve")
          await api("/leads/" + currentLead + "/messages", "PATCH", {
            messages: editedMessages(),
          });
        await api("/leads/" + currentLead + "/decision", "POST", {
          decision: action,
        });
        toast("Decisão registrada");
        break;
      case "reanalyze":
        await api("/leads/" + currentLead + "/reanalyze", "POST", {});
        toast("Reanálise enviada à fila");
        break;
      case "whatsapp": {
        const message = editedMessages()[0]?.text;
        if (
          !confirm(
            "Abrir o WhatsApp com a mensagem que você acabou de revisar? O envio será manual.",
          )
        )
          break;
        const w = window.open("about:blank", "_blank");
        try {
          const r = await api("/leads/" + currentLead + "/whatsapp", "POST", {
            message,
          });
          if (w) {
            w.opener = null;
            w.location.href = r.url;
          } else toast("Permita pop-ups para abrir o WhatsApp");
        } catch (e) {
          w?.close();
          throw e;
        }
        break;
      }
      case "do_not_contact":
      case "anonymize":
      case "delete":
        if (
          confirm(
            action === "do_not_contact"
              ? "Bloquear esta empresa em campanhas futuras?"
              : "Remover os dados desta empresa e impedir a recaptura?",
          )
        ) {
          await api("/leads/" + currentLead + "/privacy", "POST", { action });
          $("#lead-dialog").close();
          toast("Privacidade atualizada");
        }
        break;
      default:
        if (action.startsWith("run-"))
          await api("/runs/" + id + "/" + action.slice(4), "POST", {});
    }
    await refresh();
    if (
      $("#lead-dialog").open &&
      !["copy", "whatsapp", "lead", "new"].includes(action)
    )
      openLead(currentLead);
  } catch (e) {
    toast(e.message);
  } finally {
    el.disabled = false;
  }
});
$("#country").addEventListener("change", async () => {
  $("#language").value = $("#country").value === "PY" ? "es" : "pt-BR";
  try {
    await locations();
  } catch (e) {
    toast(e.message);
  }
});
$("#region").addEventListener("change", () =>
  updateCities().catch((e) => toast(e.message)),
);
$("#scope").addEventListener("change", scope);
$("#approval-filter").addEventListener("change", render);
$("#campaign-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const submit = e.submitter;
  submit.disabled = true;
  try {
    const f = Object.fromEntries(new FormData(e.target));
    const c = {
      ...f,
      region: $("#region").value,
      cities:
        f.scope === "city"
          ? [$("#city").value]
          : f.scope === "custom"
            ? $("#custom-cities")
                .value.split(";")
                .map((s) => s.trim())
                .filter(Boolean)
            : [],
      keywords: f.keywords
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    };
    for (const field of ["maxLeads", "minScore", "maxRequests", "maxCost"])
      c[field] = Number(c[field]);
    const frequency = $("#frequency").value;
    if (frequency !== "manual")
      c.schedule = {
        frequency,
        time: $("#schedule-time").value,
        days: [...document.querySelectorAll("#days input:checked")].map((x) =>
          Number(x.value),
        ),
        timezone: c.country === "PY" ? "America/Asuncion" : "America/Sao_Paulo",
      };
    const result = await api("/campaigns", "POST", c);
    $("#campaign-dialog").close();
    toast(
      `Campanha criada: ${result.batches} lotes. ${frequency !== "manual" ? "Ative a agenda no cartão da campanha." : "Clique em Iniciar captação."}`,
    );
    tab("campaigns");
    await refresh();
  } catch (e) {
    $("#form-error").textContent = e.message;
  } finally {
    submit.disabled = false;
  }
});
refresh();
setInterval(refresh, 5000);

document
  .querySelector("#password-form")
  ?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = e.submitter;
    if (
      document.querySelector("#new-password").value !==
      document.querySelector("#repeat-password").value
    ) {
      toast("As senhas não coincidem.");
      return;
    }
    button.disabled = true;
    try {
      const r = await fetch("/auth/password", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-NexTech-Request": "1",
        },
        body: JSON.stringify({
          currentPassword: document.querySelector("#current-password").value,
          newPassword: document.querySelector("#new-password").value,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw Error(data.error);
      location.replace("/login");
    } catch (e) {
      toast(e.message);
    } finally {
      button.disabled = false;
    }
  });
