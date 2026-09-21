import { describe, expect, it } from "vitest";
import { redactForPrompt } from "../src/domain/pii-redaction.js";

describe("redactForPrompt", () => {
  it("mascara CPF mantendo só os 2 últimos dígitos", () => {
    expect(redactForPrompt("CPF da cliente: 123.456.789-00")).toBe(
      "CPF da cliente: ***.***.***-00",
    );
  });

  it("mascara CPF sem pontuação", () => {
    expect(redactForPrompt("cpf 12345678900 ok")).toBe("cpf ***.***.***-00 ok");
  });

  it("mascara CNPJ inteiro mantendo os 2 últimos dígitos", () => {
    expect(redactForPrompt("CNPJ 12.345.678/0001-95")).toBe(
      "CNPJ **.***.***/****-95",
    );
  });

  it("mascara CNPJ antes de CPF quando ambos aparecem", () => {
    const result = redactForPrompt("CNPJ 12345678000195 e CPF 12345678900");
    expect(result).toBe("CNPJ **.***.***/****-95 e CPF ***.***.***-00");
  });

  it("mascara email mantendo só o domínio", () => {
    expect(redactForPrompt("chave pix maria.souza@gmail.com")).toBe(
      "chave pix ***@gmail.com",
    );
  });

  it("mascara telefone mantendo só os 4 últimos dígitos", () => {
    expect(redactForPrompt("chave +55 11 98765-4321")).toBe(
      "chave ***-***-4321",
    );
  });

  it("não altera texto sem dado sensível", () => {
    const benign = "cliente perguntou quanto custa a tarifa do boleto";
    expect(redactForPrompt(benign)).toBe(benign);
  });
});
