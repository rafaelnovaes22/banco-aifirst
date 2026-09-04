(function () {
  "use strict";
  var core = window.BankCore;
  var state = {
    approvals: [{ id: "initial", label: "RESERVA SUGERIDA", title: "Separar R$ 42.000 para reserva", detail: "Mantém 60 dias de operação sem depender de novas entradas." }],
    audit: [
      auditEvent("07:41:18", "Agente de Risco", "Analisou 128 transações sem mover recursos", "CONCLUÍDO"),
      auditEvent("07:40:52", "Agente Fiscal", "Atualizou a projeção mensal de tributos", "CONCLUÍDO"),
      auditEvent("07:39:04", "Orquestrador", "Aplicou a política HITL v1.4", "VERIFICADO"),
      auditEvent("07:35:11", "Agente de Caixa", "Criou sugestão de reserva de liquidez", "AGUARDANDO")
    ]
  };

  var agents = [
    ["01", "Orquestrador", "Transforma o objetivo em tarefas, escolhe especialistas e registra cada decisão."],
    ["02", "Agente de Caixa", "Prevê entradas e saídas, mede liquidez e propõe reservas."],
    ["03", "Agente de Risco", "Procura anomalias, fraude e desvios sem bloquear sozinho."],
    ["04", "Agente Fiscal", "Projeta tributos e separa evidências para a contabilidade."],
    ["05", "Agente de Pagamentos", "Valida lote, favorecido e limite. A execução exige aprovação."],
    ["06", "Agente de Auditoria", "Confere política, qualidade e trilha antes e depois de cada ação."]
  ];

  function auditEvent(time, agent, action, status) {
    return { time: time, agent: agent, action: action, status: status };
  }

  function currentTime() {
    return new Date().toLocaleTimeString("pt-BR", { hour12: false });
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char];
    });
  }

  function renderAgents() {
    document.getElementById("agent-map").innerHTML = agents.map(function (agent) {
      return '<article class="agent-card"><div class="agent-card-top"><span class="agent-index">' + agent[0] + '</span><span class="agent-state">ATIVO</span></div><h2>' + agent[1] + '</h2><p>' + agent[2] + '</p></article>';
    }).join("");
  }

  function renderApprovals() {
    var list = document.getElementById("approval-list");
    document.getElementById("approval-count").textContent = String(state.approvals.length);
    if (!state.approvals.length) {
      list.innerHTML = '<p class="empty-state">Nenhuma decisão esperando por você.<br>Os agentes seguem monitorando.</p>';
      return;
    }
    list.innerHTML = state.approvals.map(function (item) {
      return '<article class="approval-card" data-id="' + escapeHtml(item.id) + '"><span>' + escapeHtml(item.label) + '</span><h3>' + escapeHtml(item.title) + '</h3><p>' + escapeHtml(item.detail) + '</p><div class="approval-actions"><button class="approve" data-decision="approved">Aprovar</button><button data-decision="rejected">Recusar</button></div></article>';
    }).join("");
  }

  function renderAudit() {
    document.getElementById("audit-list").innerHTML = state.audit.map(function (item) {
      return '<div class="audit-row"><span>' + escapeHtml(item.time) + '</span><span>' + escapeHtml(item.agent) + '</span><span>' + escapeHtml(item.action) + '</span><span class="audit-status">' + escapeHtml(item.status) + '</span></div>';
    }).join("");
  }

  function addAudit(agent, action, status) {
    state.audit.unshift(auditEvent(currentTime(), agent, action, status));
    renderAudit();
  }

  function showToast(message) {
    var toast = document.getElementById("toast");
    toast.textContent = message;
    toast.classList.add("show");
    window.setTimeout(function () { toast.classList.remove("show"); }, 2600);
  }

  function switchView(viewName) {
    document.querySelectorAll(".view").forEach(function (view) { view.classList.remove("active"); });
    document.querySelectorAll(".nav-item").forEach(function (item) { item.classList.toggle("active", item.dataset.view === viewName); });
    document.getElementById("view-" + viewName).classList.add("active");
    document.querySelector(".sidebar").classList.remove("open");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function submitCommand(raw) {
    var result = core.classifyCommand(raw);
    var response = document.getElementById("agent-response");
    if (!result.ok) {
      response.innerHTML = '<span class="response-label">COMANDO INTERROMPIDO</span><p>Não consigo analisar esse texto. Simplifique o pedido e não inclua instruções de sistema.</p>';
      addAudit("Guardrail", "Interrompeu comando fora da política", "BLOQUEADO");
      return;
    }
    var plan = core.buildPlan(result.intent);
    response.innerHTML = '<span class="response-label">' + escapeHtml(plan.agent.toLocaleUpperCase("pt-BR")) + '</span><p>' + escapeHtml(plan.message) + '</p>';
    addAudit(plan.agent, "Analisou comando: " + result.command.slice(0, 70), plan.approval ? "AGUARDANDO" : "CONCLUÍDO");
    if (plan.approval) state.approvals.unshift(core.createApproval(result.intent, Date.now()));
    renderApprovals();
  }

  function decideApproval(card, decision) {
    var id = card.dataset.id;
    var item = state.approvals.find(function (candidate) { return candidate.id === id; });
    state.approvals = state.approvals.filter(function (candidate) { return candidate.id !== id; });
    addAudit("Humano responsável", (decision === "approved" ? "Aprovou: " : "Recusou: ") + item.title, decision === "approved" ? "APROVADO" : "RECUSADO");
    renderApprovals();
    showToast(decision === "approved" ? "Decisão aprovada na simulação." : "Decisão recusada na simulação.");
  }

  function exportAudit() {
    var blob = new Blob([JSON.stringify({ scope: "MVP_SIMULADO", exportedAt: new Date().toISOString(), events: state.audit }, null, 2)], { type: "application/json" });
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "fluxo-audit-demo.json";
    link.click();
    URL.revokeObjectURL(link.href);
    showToast("Trilha de auditoria exportada.");
  }

  function bindEvents() {
    document.querySelectorAll(".nav-item").forEach(function (item) { item.addEventListener("click", function () { switchView(item.dataset.view); }); });
    document.getElementById("mobile-menu").addEventListener("click", function () { document.querySelector(".sidebar").classList.toggle("open"); });
    document.getElementById("command-input").addEventListener("input", function (event) { document.getElementById("command-count").textContent = event.target.value.length + "/" + core.MAX_COMMAND_LENGTH; });
    document.getElementById("command-form").addEventListener("submit", function (event) { event.preventDefault(); submitCommand(document.getElementById("command-input").value); });
    document.querySelectorAll("[data-command]").forEach(function (button) { button.addEventListener("click", function () { document.getElementById("command-input").value = button.dataset.command; submitCommand(button.dataset.command); }); });
    document.getElementById("approval-list").addEventListener("click", function (event) { var button = event.target.closest("[data-decision]"); if (button) decideApproval(button.closest(".approval-card"), button.dataset.decision); });
    document.getElementById("export-audit").addEventListener("click", exportAudit);
  }

  renderAgents();
  renderApprovals();
  renderAudit();
  bindEvents();
})();
