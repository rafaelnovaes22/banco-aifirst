# Validação Jev no assistente do banco-aifirst

Data: 2026-09-21. Modelo: `jev-1.13.0` real (0 mocks, 0 nulls em 16 chamadas).
Alvo: `src/domain/jev-intent-check.ts`, segunda opinião calibrada sobre o intent
do assistente (stub ou LLM), em shadow. Nunca altera resposta, ticket ou dinheiro.

## Método

Choice sobre os 8 intents do `assistant-output-schema.ts` mais noul `sensitive`
para CONTESTACAO e LIMITE_PEDIDO (fail-closed). 16 mensagens PT-BR, 2 por intent,
texto já mascarado. Chave usada de forma efêmera, nunca gravada.

## Resultado

Acordo choice x esperado: 16/16 (100%), confiança 0,98 a 1,0.
Noul sensível: casos CONTESTACAO e LIMITE_PEDIDO entre 0,91 e 0,96;
não sensíveis até 0,08, exceto um caso limite abaixo.
Latência: min 262ms, p50 283ms, max 842ms (primeira chamada fria).
Timeout default do adapter (2000ms) captura todas; produção usa fire-and-forget
fora do caminho crítico, então a cauda fria não afeta o lead.

## Achado de calibração

"por que me cobraram essa taxa?" (TARIFA_DUVIDA) devolveu `sensitive 0,85`,
acima do act 0,7. O verbo "cobraram" puxa leitura de disputa.
Em shadow isso só gera log `shadow_divergence` (tripwire), sem mudar o fluxo.
Candidatos se virar ruído: subir o act do noul sensível ou refinar o critério
para exigir pedido explícito de contestação. Decisão com logs reais.

## O que falta

1. `TYPESAFE_API_KEY` via ambiente para ligar o shadow (`JEV_ENABLED=true`).
   Desligado por default. `.env` é gitignored, nunca commitar chave.
2. Janela com tráfego real para medir divergência contra stub e LLM e calibrar.
3. Reavaliar timeout de 2000ms contra a distribuição real de latência.
