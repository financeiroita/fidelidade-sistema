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

/** Instante (UTC) em que começa o dia AAAA-MM-DD no fuso informado. Ex.: 12/11 em São Paulo começa às 03:00Z. */
export function startOfLocalDay(isoDate: string, timeZone: string): Date {
  const asUtc = new Date(`${isoDate}T00:00:00Z`).getTime();
  // Diferença entre o relógio local e o UTC naquele instante; repete uma vez por causa de mudança de horário.
  const offsetAt = (ms: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
        .formatToParts(new Date(ms))
        .map((x) => [x.type, x.value]),
    );
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms;
  };
  let t = asUtc - offsetAt(asUtc);
  t = asUtc - offsetAt(t);
  return new Date(t);
}

/** Soma dias a uma data AAAA-MM-DD. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
