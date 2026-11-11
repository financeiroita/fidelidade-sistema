# 0009 — Resgate de pontos, saldo e extrato

- **Status**: Aceita (mecânica); o catálogo e os preços dos prêmios ainda são do hotel
- **Data**: 2026-11-11

## Decisão
- **Catálogo** (`Reward`): nome, tipo, custo em pontos, nível mínimo, ativo. O hotel cadastra por `POST /rewards` (rota interna). `GET /rewards` é público e mostra só os ativos, do mais barato ao mais caro. Nenhum prêmio ou preço foi inventado.
- **Pedido** (`POST /redemptions`, interno): exige `requestId` único. Repetir o mesmo pedido devolve o mesmo resgate (200) sem gastar de novo; o mesmo `requestId` em outro hóspede ou prêmio é recusado (409).
- **Saldo utilizável**: só lotes com saldo e ainda dentro da validade; pontos vencidos que a rotina noturna ainda não tirou não contam. Os pontos que vencem antes saem primeiro (FIFO), e o resgate guarda de quais lotes saíram.
- **Prêmio por nível**: vale o nível guardado; se a validade do nível acabou (rotina ainda não rodou), conta como nível inicial.
- **Ciclo**: PENDING → CONFIRMED → USED. Cancelar vale em PENDING e CONFIRMED e devolve os pontos aos lotes de origem (lançamento REVERSAL). Repetir uma ação já feita é inofensivo; usar sem confirmar, ou cancelar o que já foi usado, é recusado (409).
- **Cancelar depois que o lote venceu**: o saldo volta ao lote, mas lote vencido não é utilizável, e a rotina noturna o expira. O hóspede não ganha prazo com o cancelamento, e o extrato fica coerente (ganho, resgate, devolução, vencimento).
- **Concorrência**: tudo roda na transação do hóspede, com o hóspede travado primeiro e os lotes depois (mesma ordem do check-out e da rotina noturna). Dois pedidos simultâneos que não cabem no saldo: só um passa.
- **Saldo e extrato** (internos): `GET /guests/:id/balance` (disponível, razão e boas-vindas pendentes) e `GET /guests/:id/statement?limit=`.

## Limitações
- Não há autenticação do próprio hóspede: o resgate é feito pela recepção ou por um sistema com a chave interna. Um app/site do hóspede exige login de hóspede (decisão futura).
- Não há validade do resgate (ex.: prazo para usar o voucher) nem estoque/limite por prêmio.
- Não testado contra PostgreSQL real.
