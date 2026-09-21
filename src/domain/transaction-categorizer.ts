// PORQUÊ: a AI sugere a categoria, só o usuário confirma. Nenhum ator com
// prefixo "ai-" consegue confirmar: é o controle técnico do guardrail.

export type TransactionCategory =
  "ALUGUEL" | "INSUMOS" | "SALARIO" | "MARKETING" | "TARIFAS" | "OUTROS";

export interface CategorySuggestion {
  readonly category: TransactionCategory;
  readonly source: "RULE" | "NONE";
}

const CATEGORY_KEYWORD_RULES: readonly {
  readonly category: TransactionCategory;
  readonly keywords: readonly string[];
}[] = [
  { category: "ALUGUEL", keywords: ["aluguel", "condominio", "stud", "sala"] },
  {
    category: "INSUMOS",
    keywords: [
      "tinta",
      "mascara",
      "po descolorante",
      "insumo",
      "luva",
      "toalha",
    ],
  },
  { category: "SALARIO", keywords: ["salario", "pro-labore", "comissao"] },
  {
    category: "MARKETING",
    keywords: ["anuncio", "ads", "instagram", "divulgacao"],
  },
  { category: "TARIFAS", keywords: ["tarifa", "juros", "iof", "boleto"] },
];

export function suggestCategory(
  transactionDescription: string,
): CategorySuggestion {
  const normalized = transactionDescription.toLowerCase();
  for (const rule of CATEGORY_KEYWORD_RULES) {
    if (rule.keywords.some((keyword) => normalized.includes(keyword))) {
      return { category: rule.category, source: "RULE" };
    }
  }
  return { category: "OUTROS", source: "NONE" };
}

export interface CategorizedTransaction {
  readonly id: string;
  readonly description: string;
  readonly suggestedCategory: TransactionCategory;
  confirmedCategory?: TransactionCategory;
  confirmedByUserId?: string;
}

export class TransactionCategorizer {
  private readonly transactions = new Map<string, CategorizedTransaction>();

  register(id: string, description: string): CategorizedTransaction {
    const suggestion = suggestCategory(description);
    const transaction: CategorizedTransaction = {
      id,
      description,
      suggestedCategory: suggestion.category,
    };
    this.transactions.set(id, transaction);
    return transaction;
  }

  confirmCategory(
    transactionId: string,
    category: TransactionCategory,
    confirmedByUserId: string,
  ): CategorizedTransaction | undefined {
    // PORQUÊ: guardrail. Ator "ai-*" nunca confirma categoria: decisão humana registrada.
    if (confirmedByUserId.startsWith("ai-")) {
      throw new Error(
        `actor ${confirmedByUserId} cannot confirm category, expected human user id without "ai-" prefix`,
      );
    }
    const transaction = this.transactions.get(transactionId);
    if (!transaction) return undefined;
    transaction.confirmedCategory = category;
    transaction.confirmedByUserId = confirmedByUserId;
    return transaction;
  }

  pendingConfirmation(): readonly CategorizedTransaction[] {
    return [...this.transactions.values()].filter(
      (transaction) => !transaction.confirmedCategory,
    );
  }
}
