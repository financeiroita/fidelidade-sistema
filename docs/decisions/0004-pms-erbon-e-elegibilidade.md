# 0004 — PMS Erbon, elegibilidade e calibragem

- **Status**: Aceita
- **Data**: 2026-11-11

## Contexto
O hotel usa o PMS Erbon, que separa os gastos do folio por categoria. A diária média é R$ 700,00.

## Decisão
- Integração via adaptador `src/infra/pms/erbon/` (a criar), mapeando as categorias do Erbon para ROOM, FNB, SPA, EVENTS e OTHER. O detalhe da API do Erbon (autenticação, endpoints, formato do folio) ainda não foi verificado e precisa ser levantado antes de implementar.
- Importação idempotente por `pmsReservationId` e `pmsLineId`; lançamento manual continua disponível como alternativa.
- **Elegibilidade**: qualquer hóspede que quiser se cadastrar entra no programa, inclusive quem reservou por OTA. Sem bônus de reserva direta para OTA; só o bônus de +20% já definido no ADR 0003 para canais diretos.
- Pontos só são creditados após cadastro (consentimento registrado). Estadias anteriores ao cadastro não pontuam, salvo decisão contrária.

## Calibragem com diária de R$ 700 (referência, não decidida)
- Estadia de 3 noites ≈ R$ 2.100 → ~2.100 pontos no Bronze. Prata (3.000) sai em 1 a 2 estadias; Ouro (8.000) exige cerca de 4 estadias por ano; Diamante (20.000) cerca de 9, o que é alto para um resort de lazer. Considerar baixar Ouro e Diamante (ex.: 6.000 e 12.000).
- Diária grátis (R$ 700) a R$ 0,02 por ponto custa 35.000 pontos, ou seja, R$ 35 mil gastos. Considerar valor de resgate maior (ex.: R$ 0,03) para tornar o programa atrativo; custo ao hotel cresce na mesma proporção.

## Consequências
Os limiares de nível e o valor do ponto no ADR 0003 seguem como estão até decisão do hotel.
