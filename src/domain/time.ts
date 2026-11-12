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

/** Data (AAAA-MM-DD) no fuso do hotel. Ex.: 21h de 11/11 em São Paulo é 00h de 12/11 em UTC, mas aqui ainda é 11/11. */
export function localDate(d: Date, timeZone: string): string {
  // en-CA formata como AAAA-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Soma dias a uma data AAAA-MM-DD. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
