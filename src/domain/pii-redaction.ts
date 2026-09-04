// PORQUÊ: LGPD minimização. Nenhum documento ou chave Pix inteiro entra em prompt.
// Mantém sufixo/domínio apenas para o atendente distinguir casos parecidos.

const CPF_PATTERN = /\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g;
const CNPJ_PATTERN = /\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g;
const PIX_EMAIL_PATTERN = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const PIX_PHONE_PATTERN = /\+?55\s?\d{2}\s?9?\d{4}-?\d{4}/g;

export function redactForPrompt(text: string): string {
  // PORQUÊ: CNPJ antes de CPF. O CNPJ de 14 dígitos contém prefixo que casaria como CPF se a ordem invertesse.
  return text
    .replace(CNPJ_PATTERN, (cnpj) => `**.***.***/****-${cnpj.slice(-2)}`)
    .replace(CPF_PATTERN, (cpf) => `***.***.***-${cpf.slice(-2)}`)
    .replace(PIX_EMAIL_PATTERN, (email) => `***@${email.split("@")[1]}`)
    .replace(PIX_PHONE_PATTERN, (phone) => `***-***-${phone.slice(-4)}`);
}
