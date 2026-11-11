/**
 * Soma meses em UTC sem estourar o fim do mês: 31/01 + 1 mês = 28/02 (ou 29/02), não 03/03.
 * Única implementação usada por expiração de pontos, validade de nível e janelas.
 */
export function addMonths(d: Date, months: number): Date {
  const r = new Date(d);
  const day = r.getUTCDate();
  r.setUTCDate(1);
  r.setUTCMonth(r.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + 1, 0)).getUTCDate();
  r.setUTCDate(Math.min(day, lastDay));
  return r;
}
