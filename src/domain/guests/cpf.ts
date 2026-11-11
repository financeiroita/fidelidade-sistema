/** Remove tudo que não for dígito. */
export const onlyDigits = (v: string) => v.replace(/\D/g, '');

/** Valida CPF pelos dígitos verificadores. Aceita com ou sem máscara. */
export function isValidCpf(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  for (let t = 9; t < 11; t++) {
    let sum = 0;
    for (let i = 0; i < t; i++) sum += Number(d[i]) * (t + 1 - i);
    if (((sum * 10) % 11) % 10 !== Number(d[t])) return false;
  }
  return true;
}
