// PORQUÊ: o Pages roda sem backend. Estes testes provam sessão, comando,
// decisão com alçada, idempotência, auditoria e CSV só com o store local.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createPagesStore,
  isPagesExpired,
  pagesAudit,
  pagesAuditCsv,
  pagesCockpit,
  pagesCommand,
  pagesDecision,
  pagesGovernance,
  parsePagesStore,
  serializePagesStore,
} from "./pages-store.ts";

const CREATOR_KEY = "creator-key-001";
const SECOND_KEY = "second-key-002";

function freshDate(): Date {
  return new Date("2026-09-22T12:00:00Z");
}

test("sessão nova abre cockpit com reserva seed", async () => {
  const store = await createPagesStore(freshDate());
  const cockpit = pagesCockpit(store, freshDate()) as {
    company: { name: string };
    approvals: unknown[];
  };
  assert.equal(cockpit.company.name, "Novaes Comércio Ltda.");
  assert.equal(cockpit.approvals.length, 1);
  assert.equal(isPagesExpired(store, freshDate()), false);
});

test("comando prepara Pix de R$ 100 e auditoria registra", async () => {
  const store = await createPagesStore(freshDate());
  const payload = (await pagesCommand(
    store,
    { text: "Faça um Pix de R$ 100" },
    CREATOR_KEY,
    freshDate(),
  )) as { status: string; approval: { id: string } | null };
  assert.equal(payload.status, "APPROVAL_REQUIRED");
  assert.ok(payload.approval?.id);
  const audit = pagesAudit(store, freshDate()) as { records: unknown[]; integrity: string };
  assert.ok(audit.records.length >= 2);
  assert.equal(audit.integrity, "VERIFIED");
});

test("replay com mesma chave não duplica aprovação", async () => {
  const store = await createPagesStore(freshDate());
  const first = (await pagesCommand(store, { text: "Faça um Pix de R$ 100" }, CREATOR_KEY, freshDate())) as {
    approval: { id: string };
  };
  const second = (await pagesCommand(
    store,
    { text: "Faça um Pix de R$ 100" },
    CREATOR_KEY,
    freshDate(),
  )) as { approval: { id: string } };
  assert.equal(second.approval.id, first.approval.id);
});

test("alçada de R$ 5.000 bloqueia na decisão", async () => {
  const store = await createPagesStore(freshDate());
  const payload = (await pagesCommand(
    store,
    { text: "Faça um Pix de R$ 6.000" },
    CREATOR_KEY,
    freshDate(),
  )) as { approval: { id: string; version: number } };
  const result = await pagesDecision(
    store,
    payload.approval.id,
    { decision: "APPROVE", expectedVersion: 1 },
    SECOND_KEY,
    freshDate(),
  );
  assert.equal(result.blocked, true);
});

test("Pix de R$ 100 aprova no papel humano e debita uma vez", async () => {
  const store = await createPagesStore(freshDate());
  const before = store.state.balanceInCents;
  const payload = (await pagesCommand(
    store,
    { text: "Faça um Pix de R$ 100" },
    CREATOR_KEY,
    freshDate(),
  )) as { approval: { id: string; version: number } };
  const result = await pagesDecision(
    store,
    payload.approval.id,
    { decision: "APPROVE", expectedVersion: 1 },
    SECOND_KEY,
    freshDate(),
  );
  assert.equal(result.blocked, false);
  assert.equal(store.state.balanceInCents, before - 10_000);
});

test("sessão expirada falha fechada", async () => {
  const store = await createPagesStore(freshDate());
  const late = new Date(freshDate().getTime() + 9 * 60 * 60 * 1_000);
  assert.equal(isPagesExpired(store, late), true);
  assert.throws(() => pagesCockpit(store, late));
  await assert.rejects(pagesCommand(store, { text: "x" }, CREATOR_KEY, late));
});

test("serialização com versão errada é ilegível", async () => {
  const store = await createPagesStore(freshDate());
  const raw = JSON.parse(serializePagesStore(store)) as Record<string, unknown>;
  raw["version"] = 999;
  assert.throws(() => parsePagesStore(JSON.stringify(raw)));
  assert.throws(() => parsePagesStore("não é json"));
});

test("CSV exporta cadeia com cabeçalho", async () => {
  const store = await createPagesStore(freshDate());
  await pagesCommand(store, { text: "Projete meu caixa por 60 dias" }, CREATOR_KEY, freshDate());
  const csv = pagesAuditCsv(store, freshDate());
  assert.match(csv, /seq,recordedAt,agent,action/);
  assert.match(csv, /SESSÃO_CRIADA/);
});

test("governança declara armazenamento local", () => {
  const gov = pagesGovernance() as { storage: string; live_finance: boolean };
  assert.equal(gov.storage, "localStorage");
  assert.equal(gov.live_finance, false);
});
