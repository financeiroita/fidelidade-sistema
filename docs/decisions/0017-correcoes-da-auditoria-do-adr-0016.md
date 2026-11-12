# 0017. Correções da auditoria do ADR 0016

- Status: Aceita
- Data: 2026-11-12
- Completa: itens 1, 3 e 5 do ADR 0016

## Contexto
Um auditor revisou o commit do ADR 0016. Encontrou um problema de gravidade média (dava para contornar o limite de faixa do proxy) e alguns de gravidade baixa.

## Decisões
1. **Proxy (completa o item 5 do ADR 0016):** um IPv4 escrito como IPv6 (`::ffff:0.0.0.0/96`) segue a regra do IPv4. É preciso pelo menos `/104`, ou seja, 96 + 8. Antes, `::ffff:0.0.0.0/96` passava e confiava em todo o IPv4.
2. **O nível também vale até o fim do dia do hotel** (completa o item 1 do ADR 0016):
   - A validade de um nível conquistado ou renovado é o início do dia seguinte, no fuso do hotel, como já acontece com os pontos (`endOfHotelDayAfterMonths` em `src/domain/time.ts`).
   - A "Minha conta" mostra o último dia de validade.
   - Se a validade já passou e a rotina noturna ainda não rodou, a página não mostra uma data vencida.
3. **Os meses são somados na data do hotel.** Dois créditos do mesmo dia do hotel vencem no mesmo dia, mesmo que um seja às 11h e o outro às 22h.
4. **Horário de verão:** se ele voltar a começar à meia-noite, o dia passa a começar no primeiro instante que existe, e os pontos não vencem uma hora antes.
5. **Regra única de nível, de fato** (completa o item 3 do ADR 0016):
   - o check-out chama `effectiveTierRank`, em vez de repetir a regra;
   - a resposta de um check-out já processado mostra o nível que vale agora.
6. **Node 20.12 ou mais novo** (`package.json`), porque é a versão que lê o `.env` (`process.loadEnvFile`). Numa versão mais antiga, o servidor avisa e não inicia, em vez de ignorar o `.env` sem dizer nada.
7. **Extrato:** a ordem entre linhas da mesma data e hora é arbitrária, mas estável (desempate pelo id).

## Testes acrescentados
- Proxy com IPv4 escrito como IPv6.
- Horário de verão em São Paulo (2018) e em Santiago.
- Créditos do mesmo dia.
- Os três casos de nível vencido no check-out e a resposta de reprocessamento.
- O rastro de código errado e a validade vencida escondida.
- Resgate com nível vencido no PostgreSQL real e bloqueio de código no PostgreSQL real.
