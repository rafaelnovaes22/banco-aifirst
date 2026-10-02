// PORQUÊ: massa determinística do caso simulado PME-300 (seed fixa).
// 300 movimentos de prestadora de serviços + 170 comprovantes com
// únicos, ambíguos (gêmeos de valor/data) e sem match. Reproduzível.
import { writeFileSync } from "node:fs";

function mulberry32(seed) {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(300);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const pad = (n) => String(n).padStart(2, "0");
const day = (d) => `2026-09-${pad(d)}`;
const cents = (min, max) => Math.round(min + rand() * (max - min));
const brl = (v) =>
  `${Math.floor(v / 100)}.${pad(v % 100)}`.replace(".", "#").replace("#", ",");

const CLIENTES = [
  "Alfa",
  "Beta",
  "Delta",
  "Epsilon",
  "Zeta",
  "Kappa",
  "Ômega",
  "Sigma",
  "Vega",
  "Prisma",
];
const FORNEC = ["Gama", "Lambda", "Taurus", "Nimbus", "Faria"];

const movs = [];
let seq = 1;
const id = () => `p${seq++}`;
const usedIn = new Map();

function addIn(date, amount, desc) {
  const m = { id: id(), date, amount, desc, dir: "IN" };
  movs.push(m);
  if (!usedIn.has(`${amount}|${date}`)) usedIn.set(`${amount}|${date}`, []);
  usedIn.get(`${amount}|${date}`).push(m.id);
  return m;
}

// 170 IN únicos variados
for (let i = 0; i < 170; i++) {
  addIn(
    day(1 + Math.floor(rand() * 28)),
    cents(5000, 800000),
    `${pick(["TED cliente", "Pix cliente", "Boleto cliente"])} ${pick(CLIENTES)}`,
  );
}
// 10 pares gêmeos (mesmo valor, datas a até 1 dia) para ambiguidade real
const gemeos = [];
for (let i = 0; i < 10; i++) {
  const amount = cents(10000, 300000);
  const d = 2 + Math.floor(rand() * 26);
  const a = addIn(day(d), amount, `Pix cliente ${pick(CLIENTES)}`);
  const b = addIn(
    day(d + (rand() < 0.5 ? 0 : 1)),
    amount,
    `TED cliente ${pick(CLIENTES)}`,
  );
  gemeos.push([a, b]);
}
// 110 OUT (não casam: matcher só olha IN)
for (let i = 0; i < 110; i++) {
  movs.push({
    id: id(),
    date: day(1 + Math.floor(rand() * 28)),
    amount: cents(2000, 500000),
    desc: `${pick(["Boleto", "TED", "Pix"])} ${pick(["fornecedor", "aluguel", "energia", "DAS", "salário"])} ${pick(FORNEC)}`,
    dir: "OUT",
  });
}

// Comprovantes: 150 únicos (IN sem gêmeo), 10 ambíguos (1 por par), 10 sem match
const gemeoIds = new Set(gemeos.flat().map((m) => m.id));
const singleIns = movs.filter((m) => m.dir === "IN" && !gemeoIds.has(m.id));
const comps = [];
for (let i = 0; i < 150; i++) {
  const m = singleIns[i];
  comps.push({ amountInCents: m.amount, occurredOn: m.date });
}
for (const [a] of gemeos)
  comps.push({ amountInCents: a.amount, occurredOn: a.date });
const insAmounts = new Set(
  movs.filter((m) => m.dir === "IN").map((m) => `${m.amount}|${m.date}`),
);
let ghost = 9999900;
for (let i = 0; i < 10; i++) {
  while ([...insAmounts].some((k) => k.startsWith(`${ghost}|`))) ghost += 100;
  comps.push({ amountInCents: ghost, occurredOn: day(5 + i * 2) });
  ghost += 777;
}

const csv = [
  "id;data;descricao;valor;direcao",
  ...movs.map((m) => `${m.id};${m.date};${m.desc};${brl(m.amount)};${m.dir}`),
].join("\n");
writeFileSync("demo-data-pme300.csv", csv);
writeFileSync(
  "demo-data-pme300-comprovantes.json",
  JSON.stringify(comps, null, 2),
);
console.log(
  JSON.stringify({
    movimentos: movs.length,
    comprovantes: comps.length,
    gemeos: gemeos.length,
  }),
);
