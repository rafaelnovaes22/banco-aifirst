// PORQUÊ: o resumo de domingo é o ativo de retenção. Texto montado de números
// do ledger, nunca de texto gerado. Formato fixo de 5 linhas para o WhatsApp.

export interface OverdueClient {
  readonly clientName: string;
  readonly amountInCents: number;
}

export interface WeeklySummaryInput {
  readonly orgName: string;
  readonly balanceInCents: number;
  readonly weekInInCents: number;
  readonly weekOutInCents: number;
  readonly overdueClients: readonly OverdueClient[];
  readonly lowestProjectedDay: string;
  readonly lowestProjectedBalanceInCents: number;
}

function reais(cents: number): string {
  return `R$${(cents / 100).toFixed(2)}`;
}

export function buildWeeklySummary(input: WeeklySummaryInput): string {
  const overdueLine =
    input.overdueClients.length === 0
      ? "nenhuma cobrança em atraso. Bom trabalho!"
      : input.overdueClients
          .slice(0, 3)
          .map(
            (client) => `${client.clientName} (${reais(client.amountInCents)})`,
          )
          .join(", ");
  return [
    `${input.orgName}: resumo da semana`,
    `saldo ${reais(input.balanceInCents)} | entrou ${reais(input.weekInInCents)} | saiu ${reais(input.weekOutInCents)}`,
    `em atraso: ${overdueLine}`,
    `ponto mais baixo projetado: ${input.lowestProjectedDay} (${reais(input.lowestProjectedBalanceInCents)})`,
    "responda CAIXA para ver os próximos 7 dias em detalhe",
  ].join("\n");
}
