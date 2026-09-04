// PORQUÊ: o servidor é a fonte de verdade; o navegador só renderiza snapshots persistidos.
type ViewName = "cockpit" | "agents" | "audit" | "governance";
type Decision = "APPROVE" | "REJECT";
type SessionResponse = { csrfToken: string };
// prettier-ignore
type Approval = { id: string; kind: string; label: string; title: string; detail: string; version: number };
// prettier-ignore
type MoneySummary = { balanceInCents: number; forecastInCents: number; receivablesInCents: number; expensesInCents: number };
// prettier-ignore
type CockpitResponse = { company: { name: string; sessionLabel: string }; money: MoneySummary; risk: { label: string; score: number }; approvals: Approval[]; charges: Array<{ status: string; dueDate: string }>; updatedAt: string };
// prettier-ignore
type CommandResponse = { agent: string; message: string; status: "COMPLETED" | "APPROVAL_REQUIRED" | "BLOCKED"; approval: Approval | null };
// prettier-ignore
type AuditEvent = { recordedAt: string; agent: string; action: string; status: string };
type AuditResponse = {
  records: AuditEvent[];
  integrity: "VERIFIED" | "COMPROMISED";
};
type ErrorPayload = { error?: { message?: string } };

// prettier-ignore
const moneyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
// prettier-ignore
const timeFormatter = new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" });
let csrfToken = "";
let auditLoaded = false;
let toastTimeout: number | undefined;

// prettier-ignore
class ApiRequestError extends Error { constructor(readonly status: number, message: string) { super(message); } }

function byId<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Elemento ausente: ${id}; esperado ID existente`);
  return found as T;
}

function apiError(response: Response, payload: unknown): ApiRequestError {
  const envelope = payload as ErrorPayload | undefined;
  const fallback = `A API respondeu com status ${response.status}`;
  // prettier-ignore
  return new ApiRequestError(response.status, envelope?.error?.message ?? fallback);
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: "same-origin" });
  const payload: unknown = await response.json().catch(() => undefined);
  if (!response.ok) throw apiError(response, payload);
  return payload as T;
}

function mutationHeaders(): Headers {
  const headers = new Headers({ "Content-Type": "application/json" });
  headers.set("Idempotency-Key", crypto.randomUUID());
  if (csrfToken) headers.set("X-CSRF-Token", csrfToken);
  return headers;
}

async function mutateJson<T>(path: string, body: unknown): Promise<T> {
  // prettier-ignore
  return requestJson<T>(path, { method: "POST", headers: mutationHeaders(), body: JSON.stringify(body) });
}

function setLoadedText(id: string, value: string): void {
  const target = byId(id);
  target.textContent = value;
  target.classList.remove("skeleton", "skeleton-text");
  target.removeAttribute("aria-label");
}

function formatMoment(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Atualização recente";
  return `Atualizado às ${timeFormatter.format(parsed)}`;
}

function failureMessage(error: unknown): string {
  if (!(error instanceof ApiRequestError))
    return "Falha de conexão. Verifique a rede e tente novamente.";
  if (error.status === 401) return "A sessão expirou. Reconecte o ambiente.";
  if (error.status === 429)
    return "Muitas tentativas. Aguarde e tente novamente.";
  return error.message;
}

function setCommandEnabled(enabled: boolean): void {
  byId<HTMLTextAreaElement>("command-input").disabled = !enabled;
  byId<HTMLButtonElement>("command-submit").disabled = !enabled;
  const suggestions =
    document.querySelectorAll<HTMLButtonElement>("[data-command]");
  suggestions.forEach((button) => (button.disabled = !enabled));
}

function setConnectionState(state: "loading" | "ready" | "error"): void {
  const dot = byId("system-status-dot");
  dot.classList.toggle("is-loading", state === "loading");
  dot.classList.toggle("is-error", state === "error");
  document.body.dataset.appState = state;
}

function showAppFailure(error: unknown): void {
  byId("app-banner-message").textContent = failureMessage(error);
  byId("app-banner").hidden = false;
  byId("system-status").textContent = "Integração indisponível";
  byId("system-detail").textContent = "Dados não sincronizados";
  setConnectionState("error");
}

function showConnectedState(): void {
  byId("app-banner").hidden = true;
  byId("system-status").textContent = "Sistema sincronizado";
  byId("system-detail").textContent = "Dados persistidos no sandbox";
  setConnectionState("ready");
}

function renderCash(money: MoneySummary): void {
  setLoadedText("balance", moneyFormatter.format(money.balanceInCents / 100));
  setLoadedText("forecast", moneyFormatter.format(money.forecastInCents / 100));
  setLoadedText("balance-trend", "Saldo persistido no sandbox");
}

function renderRisk(risk: CockpitResponse["risk"]): void {
  const target = byId("risk-label");
  const tone = risk.score <= 25 ? "low" : risk.score <= 60 ? "medium" : "high";
  setLoadedText("risk-label", risk.label);
  target.classList.remove("risk-low", "risk-medium", "risk-high");
  target.classList.add(`risk-${tone}`);
  setLoadedText("risk-detail", `${risk.score} de 100 pontos`);
}

function renderMetrics(cockpit: CockpitResponse): void {
  const { money } = cockpit;
  const openCharges = cockpit.charges.filter(
    (charge) => charge.status === "OPEN",
  );
  const today = new Date().toISOString().slice(0, 10);
  const overdue = openCharges.filter((charge) => charge.dueDate < today).length;
  // prettier-ignore
  setLoadedText("receivables", moneyFormatter.format(money.receivablesInCents / 100));
  setLoadedText("receivables-detail", "Consolidado persistido");
  // prettier-ignore
  setLoadedText("expenses", moneyFormatter.format(money.expensesInCents / 100));
  setLoadedText("charges-open", String(openCharges.length));
  setLoadedText(
    "charges-detail",
    overdue === 1 ? "1 cobrança vencida" : `${overdue} cobranças vencidas`,
  );
  renderRisk(cockpit.risk);
}

function textElement(
  tag: keyof HTMLElementTagNameMap,
  text: string,
  className = "",
): HTMLElement {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function decisionButton(label: string, decision: Decision): HTMLButtonElement {
  const className = decision === "APPROVE" ? "approve" : "";
  const button = textElement("button", label, className) as HTMLButtonElement;
  button.type = "button";
  button.dataset.decision = decision;
  return button;
}

function approvalCard(approval: Approval): HTMLElement {
  const card = document.createElement("article");
  const actions = document.createElement("div");
  card.className = "approval-card";
  card.dataset.approvalId = approval.id;
  card.dataset.approvalVersion = String(approval.version);
  actions.className = "approval-actions";
  actions.append(
    decisionButton("Aprovar", "APPROVE"),
    decisionButton("Recusar", "REJECT"),
  );
  card.append(
    textElement("span", approval.label),
    textElement("h3", approval.title),
  );
  card.append(textElement("p", approval.detail), actions);
  return card;
}

function renderApprovals(approvals: CockpitResponse["approvals"]): void {
  const list = byId("approval-list");
  const cards = approvals.map(approvalCard);
  const empty =
    "Nenhuma decisão aguardando você. Os agentes seguem monitorando.";
  if (cards.length === 0) cards.push(textElement("p", empty, "empty-state"));
  byId("approval-count").textContent = String(approvals.length);
  byId("approval-count").classList.remove("is-loading");
  list.setAttribute("aria-busy", "false");
  list.replaceChildren(...cards);
}

function renderCockpit(cockpit: CockpitResponse): void {
  setLoadedText("organization-name", cockpit.company.name);
  setLoadedText("cockpit-as-of", formatMoment(cockpit.updatedAt));
  byId("system-detail").textContent = cockpit.company.sessionLabel;
  renderCash(cockpit.money);
  renderMetrics(cockpit);
  renderApprovals(cockpit.approvals);
}

async function loadCockpit(): Promise<void> {
  byId("view-cockpit").setAttribute("aria-busy", "true");
  byId("cockpit-state").hidden = true;
  try {
    renderCockpit(await requestJson<CockpitResponse>("/api/v1/cockpit"));
  } catch (error) {
    byId("cockpit-state-message").textContent = failureMessage(error);
    byId("cockpit-state").hidden = false;
  } finally {
    byId("view-cockpit").setAttribute("aria-busy", "false");
  }
}

// prettier-ignore
function renderAgentResponse(label: string, message: string, failed = false): void {
  const response = byId("agent-response");
  response.classList.toggle("is-error", failed);
  response.replaceChildren(textElement("span", label, "response-label"), textElement("p", message));
}

function setCommandBusy(busy: boolean): void {
  byId("command-form").setAttribute("aria-busy", String(busy));
  setCommandEnabled(!busy);
  const label = busy ? "Analisando..." : "Analisar comando";
  byId("command-submit").textContent = label;
}

function showToast(message: string): void {
  const toast = byId("toast");
  toast.textContent = message;
  toast.classList.add("show");
  if (toastTimeout) window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => toast.classList.remove("show"), 2600);
}

async function refreshPersistentViews(): Promise<void> {
  const pending = [loadCockpit()];
  if (auditLoaded) pending.push(loadAudit());
  await Promise.all(pending);
}

async function applyCommandResult(result: CommandResponse): Promise<void> {
  const blocked = result.status === "BLOCKED";
  const agent = result.agent.toLocaleUpperCase("pt-BR");
  renderAgentResponse(agent, result.message, blocked);
  showToast(
    blocked
      ? "Comando bloqueado pelas políticas do sandbox."
      : result.approval
        ? "Plano enviado para aprovação."
        : "Análise concluída e persistida.",
  );
  byId<HTMLTextAreaElement>("command-input").value = "";
  byId("command-count").textContent = "0/240";
  await refreshPersistentViews();
}

async function submitCommand(text: string): Promise<void> {
  const command = text.trim();
  // prettier-ignore
  if (!command) return renderAgentResponse("COMANDO NECESSÁRIO", "Descreva o resultado esperado.", true);
  setCommandBusy(true);
  renderAgentResponse(
    "ORQUESTRADOR",
    "Analisando contexto, políticas e necessidade de aprovação.",
  );
  try {
    const result = await mutateJson<CommandResponse>("/api/v1/commands", {
      text: command,
    });
    await applyCommandResult(result);
  } catch (error) {
    renderAgentResponse("COMANDO NÃO CONCLUÍDO", failureMessage(error), true);
  } finally {
    setCommandBusy(false);
  }
}

function setApprovalBusy(card: HTMLElement, busy: boolean): void {
  card.setAttribute("aria-busy", String(busy));
  card.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
    button.disabled = busy;
  });
}

async function decideApproval(button: HTMLButtonElement): Promise<void> {
  const card = button.closest<HTMLElement>(".approval-card");
  const decision = button.dataset.decision as Decision | undefined;
  if (!card || !decision) return;
  setApprovalBusy(card, true);
  const id = encodeURIComponent(card.dataset.approvalId ?? "");
  const expectedVersion = Number(card.dataset.approvalVersion);
  try {
    // prettier-ignore
    await mutateJson(`/api/v1/approvals/${id}/decisions`, { decision, expectedVersion });
    const message =
      decision === "APPROVE"
        ? "Decisão aprovada e persistida."
        : "Decisão recusada e persistida.";
    showToast(message);
    await refreshPersistentViews();
  } catch (error) {
    await handleDecisionFailure(error);
  } finally {
    setApprovalBusy(card, false);
  }
}

async function handleDecisionFailure(error: unknown): Promise<void> {
  if (error instanceof ApiRequestError && error.status === 409) {
    showToast("A decisão já mudou. A fila foi atualizada.");
    await loadCockpit();
    return;
  }
  showToast(failureMessage(error));
}

function auditStatusClass(status: string): string {
  if (/PENDING|AWAITING|AGUARDANDO/i.test(status)) return "awaiting";
  if (/BLOCKED|REJECTED|FAILED|BLOQUEADO|RECUSADO/i.test(status))
    return "blocked";
  return "completed";
}

function auditRow(event: AuditEvent): HTMLElement {
  const row = document.createElement("div");
  const statusClass = `audit-status ${auditStatusClass(event.status)}`;
  const label = event.status.replaceAll("_", " ");
  row.className = "audit-row";
  row.append(
    textElement("span", new Date(event.recordedAt).toLocaleString("pt-BR")),
  );
  row.append(
    textElement("span", event.agent),
    textElement("span", event.action),
  );
  row.append(textElement("span", label, statusClass));
  return row;
}

function renderAudit(result: AuditResponse): void {
  const list = byId("audit-list");
  const rows = result.records.map(auditRow);
  const empty = "Nenhum evento auditável foi registrado ainda.";
  if (rows.length === 0) rows.push(textElement("p", empty, "empty-state"));
  list.replaceChildren(...rows);
  list.setAttribute("aria-busy", "false");
  const valid = result.integrity === "VERIFIED";
  const integrity = valid ? "Cadeia íntegra" : "Integridade requer revisão";
  byId("audit-chain-status").textContent = integrity;
  byId("audit-chain-status").className = valid ? "is-valid" : "is-invalid";
  byId<HTMLButtonElement>("export-audit").disabled =
    result.records.length === 0;
}

async function loadAudit(): Promise<void> {
  byId("audit-list").setAttribute("aria-busy", "true");
  byId("audit-state").hidden = true;
  try {
    renderAudit(await requestJson<AuditResponse>("/api/v1/audit?limit=50"));
    auditLoaded = true;
  } catch (error) {
    byId("audit-state-message").textContent = failureMessage(error);
    byId("audit-state").hidden = false;
    byId("audit-chain-status").textContent = "Integridade não verificada";
  }
}

async function exportAudit(): Promise<void> {
  const button = byId<HTMLButtonElement>("export-audit");
  button.disabled = true;
  button.textContent = "Exportando...";
  try {
    const response = await fetch("/api/v1/audit/export", {
      credentials: "same-origin",
    });
    if (!response.ok)
      throw apiError(response, await response.json().catch(() => undefined));
    downloadBlob(await response.blob());
    showToast("Trilha persistida exportada.");
  } catch (error) {
    showToast(failureMessage(error));
  } finally {
    button.disabled = false;
    button.textContent = "Exportar CSV";
  }
}

function downloadBlob(blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "fluxo-auditoria.csv";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function closeMobileMenu(): void {
  document.querySelector(".sidebar")?.classList.remove("open");
  byId("mobile-menu").setAttribute("aria-expanded", "false");
}

function switchView(viewName: ViewName): void {
  document
    .querySelectorAll(".view")
    .forEach((view) => view.classList.remove("active"));
  document.querySelectorAll<HTMLElement>(".nav-item").forEach((item) => {
    const active = item.dataset.view === viewName;
    item.classList.toggle("active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  byId(`view-${viewName}`).classList.add("active");
  closeMobileMenu();
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (viewName === "audit" && !auditLoaded) void loadAudit();
}

function toggleMobileMenu(): void {
  const sidebar = document.querySelector(".sidebar");
  const open = !sidebar?.classList.contains("open");
  sidebar?.classList.toggle("open", open);
  byId("mobile-menu").setAttribute("aria-expanded", String(open));
}

function bindNavigation(): void {
  document.querySelectorAll<HTMLElement>("[data-view]").forEach((button) => {
    // prettier-ignore
    button.addEventListener("click", () => switchView(button.dataset.view as ViewName));
  });
  byId("mobile-menu").addEventListener("click", toggleMobileMenu);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeMobileMenu();
  });
}

function bindCommand(): void {
  const input = byId<HTMLTextAreaElement>("command-input");
  const suggestions =
    document.querySelectorAll<HTMLButtonElement>("[data-command]");
  byId("command-form").addEventListener("submit", (event) => {
    event.preventDefault();
    void submitCommand(input.value);
  });
  input.addEventListener(
    "input",
    () => (byId("command-count").textContent = `${input.value.length}/240`),
  );
  suggestions.forEach((button) => {
    button.addEventListener(
      "click",
      () => void submitCommand(button.dataset.command ?? ""),
    );
  });
}

function bindActions(): void {
  byId("approval-list").addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>("[data-decision]");
    if (button) void decideApproval(button);
  });
  byId("export-audit").addEventListener("click", () => void exportAudit());
  byId("retry-audit").addEventListener("click", () => void loadAudit());
  byId("retry-cockpit").addEventListener("click", () => void loadCockpit());
  byId("retry-app").addEventListener("click", () => void bootstrap());
}

async function bootstrap(): Promise<void> {
  setConnectionState("loading");
  setCommandEnabled(false);
  try {
    const session = await requestJson<SessionResponse>("/api/v1/session", {
      method: "POST",
    });
    csrfToken = session.csrfToken;
    showConnectedState();
    setCommandEnabled(true);
    await loadCockpit();
  } catch (error) {
    showAppFailure(error);
  }
}

bindNavigation();
bindCommand();
bindActions();
void bootstrap();
