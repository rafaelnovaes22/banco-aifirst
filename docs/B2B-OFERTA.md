# Oferta B2B Fluxo OS para bancos

Pivot: não abrir banco. Encaixar no banco que já existe.

## Pacotes

1. Conciliação: baixa comprovante contra extrato por valor e data. Ambíguo sobe para humano. Gera trilha com hash.
2. DRE contínua: classifica por regra, humano confirma, resume em 5 linhas e projeta caixa 7 dias.

## Números que vendem

- Base pública: 621 vagas de conciliação remota e 649 vagas de backoffice ativas no Brasil.
- Referências de automação financeira: 85 por cento de AP automatizado em 4 semanas, 120 horas por mês devolvidas, 220 por cento de ROI no mês 1, 1500 horas por mês em BPO.
- Proposta: diagnóstico de 2 semanas com extrato anonimizado. Piloto shadow de 3 semanas em leitura, sem tocar em dinheiro. Preço em 25 por cento da economia de BCOC comprovada.

## Piloto

Entrada: CSV do core com id, data, descricao, valor e direcao.
Saída: taxa de baixa automática, horas economizadas e economia mensal, mais trilha auditável.
Critério: acima de 95 por cento de acerto em 500 a 1000 movimentos.

## Operação Novais

Site com demo Pages. Pool de 4 a 6 PJs de confiança alocados por hora. Contrato setup mais mensalidade por volume conciliado.

## Como rodar o piloto shadow

```powershell
npm run piloto:shadow -- demo-data-extrato.csv --comprovantes demo-data-comprovantes.json --org "Banco Piloto"
```

Sem `--comprovantes`, a taxa de baixa sai zerada e o DRE continua válido. Falha sem CSV, com uso esperado em JSON no stderr.
