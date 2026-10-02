# Caso simulado PME-300: conciliação de 300 lançamentos/mês

Processo: conciliação bancária mensal de uma prestadora de serviços com
300 movimentações (190 entradas, 110 saídas) e 170 comprovantes.
O agente baixa o que casa sem ambiguidade; o resto sobe para humano.

## De onde vêm as premissas (fontes públicas, 2024-2026)

- OPTA Contábil: 150 a 500 lançamentos/mês levam 12 a 20h manuais e
  4 a 8h com automação e fila de exceções.
- Ledware: 200 a 500 movimentações custam 4 a 8h/mês manuais contra
  15 a 30 min por cliente com sistema bem configurado.
- Barte: 1.200 recebimentos/mês sem automação consomem cerca de 200h
  de uma pessoa; conta a R$ 48/h de custo cheio.
- Mobits: custo-hora médio de R$ 45 do profissional financeiro com encargos.
- APQC via CFO.com: reconciliar uma conta leva 2,6h (top), 4h (mediana)
  e 5h ou mais (piores). Automação foca o esforço nas exceções.

Premissas adotadas, lado conservador: 3 min por lançamento manual,
R$ 48/h de custo cheio, 300 movimentos/mês. Manual total: 15h e R$ 720/mês,
dentro da faixa OPTA de 12 a 20h.

## Como reproduzir

```powershell
node scripts/gen-caso-pme300.mjs
npm run piloto:shadow -- demo-data-pme300.csv --comprovantes demo-data-pme300-comprovantes.json --org "PME Servicos 300" --minutos 3 --custo-hora-centavos 4800 --movimentos-mes 300
```

## Resultado do agente (02/10/2026)

| Métrica                     | Manual                 | Com agente                       |
| --------------------------- | ---------------------- | -------------------------------- |
| Baixas automáticas          | 0 de 300               | 150 de 300 (50%)                 |
| Ambíguas para humano        | tudo manual            | 20 (10 pares gêmeos)             |
| Sem match / sem comprovante | tudo manual            | 30 na fila de revisão            |
| Horas/mês                   | 15,0                   | 7,5 residuais                    |
| Custo/mês                   | R$ 720                 | R$ 360                           |
| Economia                    | base                   | 7,5h e R$ 360/mês (R$ 4.320/ano) |
| DRE                         | dias após o fechamento | imediata, por categoria          |

## Leitura honesta

- Dados simulados com seed fixa, não um cliente real.
- A taxa de 50% reflete 170 comprovantes para 300 movimentos; com
  comprovantes completos ela sobe, com extrato bagunçado ela cai.
- O matcher só casa entradas, por valor e data com 1 dia de tolerância;
  texto nunca decide e ambíguo sempre sobe para humano.
- O residual de 7,5h cai dentro da faixa com automação da OPTA (4 a 8h).
