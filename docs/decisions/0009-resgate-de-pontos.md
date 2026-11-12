# 0009 — Resgate de pontos, saldo e extrato

- **Status**: Aceita (mecânica); o catálogo e os preços dos prêmios ainda são do hotel
- **Data**: 2026-11-11

## Decisão
- **Catálogo** (`Reward`): nome, tipo, custo em pontos, nível mínimo, ativo. O hotel cadastra por `POST /rewards` (rota interna). `GET /rewards` é público e mostra só os ativos, do mais barato ao mais caro. Nenhum prêmio ou preço foi inventado.
- **Pedido** (`POST /redemptions`, interno): exige `requestId` único. Repetir o mesmo pedido devolve o mesmo resgate (200) sem gastar de novo; o mesmo `requestId` em outro hóspede ou prêmio é recusado (409).
- **Saldo utilizável**: só lotes com saldo e ainda dentro da validade; pontos vencidos que a rotina noturna ainda não tirou não contam. Os pontos que vencem antes saem primeiro (FIFO), e o resgate guarda de quais lotes saíram.
- **Prêmio por nível**: vale o nível guardado; se a validade do nível acabou (rotina ainda não rodou), conta como nível inicial.
- **Ciclo**: PENDING → CONFIRMED → USED. Cancelar vale em PENDING e CONFIRMED e devolve os pontos aos lotes de origem (lançamento REVERSAL). Repetir uma ação já feita é inofensivo; usar sem confirmar, ou cancelar o que já foi usado, é recusado (409).
- **Cancelar depois que o lote venceu** (corrigido na auditoria): a parte devolvida a um lote já vencido não volta a ter saldo; é lançada como vencida na hora (EXPIRE com chave `redeem-cancel-expire:<resgate>:<lote>`), sem dar prazo extra. A primeira versão deixava o saldo no lote e dependia da rotina noturna, o que criava saldo fantasma quando o lote já tinha recebido o lançamento de vencimento.
- **Concorrência**: tudo roda na transação do hóspede, com o hóspede travado primeiro e os lotes depois (mesma ordem do check-out e da rotina noturna). Dois pedidos simultâneos que não cabem no saldo: só um passa.
- **Saldo e extrato** (internos): `GET /guests/:id/balance` (disponível, razão e boas-vindas pendentes) e `GET /guests/:id/statement?limit=`.

## Limitações
- Não há autenticação do próprio hóspede: o resgate é feito por um funcionário com login (ver ADR 0010). Um app/site do hóspede exige login de hóspede (decisão futura).
- Não há validade do resgate (ex.: prazo para usar o voucher) nem estoque/limite por prêmio.
- Testado em PostgreSQL 18 embutido (`npm run test:integration`); falta validar no 16 do docker-compose.

## Auditoria de 2026-11-11
Corrigido:
- **Saldo fantasma no cancelamento** (crítico): ver "Cancelar depois que o lote venceu". Testado com lote vencido antes e depois da rotina noturna, e com dois lotes.
- Devolução ao lote só até o que o lote creditou (checado no próprio UPDATE); restrições de banco na migração `prisma/migrations/*_constraints` (saldo nunca negativo nem acima do creditado, pontos positivos), aplicadas junto com as demais migrações.
- `use` só aceita estadia que existe e é do mesmo hóspede (422 `invalid_stay`).
- `PATCH /rewards/:id` corrige preço/nome/nível ou retira o prêmio (`active: false`); resgates já feitos continuam seguindo o ciclo.
- A hora do pedido é lida depois da trava do hóspede (lote que venceu na espera não é consumido); extrato de hóspede inexistente dá 404; índices de apoio e unicidade (resgate, lote).
- A memória valida antes de gravar (como o banco).

Em aberto:
1. ~~**Quem fez o quê:** a chave interna é única e compartilhada; falta ator por operador (`x-actor` ou chave por pessoa) gravado em resgate, confirmação e cancelamento.~~ Resolvido no ADR 0010: login por funcionário e auditoria (o cabeçalho `x-actor` nunca foi adotado).
2. Pedido repetido de um resgate cancelado devolve o resgate cancelado (não cria outro); quem chama deve olhar o `status`. Um novo pedido exige novo `requestId`.
3. Lote sem validade (`expiresAt` nulo) nunca é utilizável nem vence; nenhum fluxo cria isso hoje.
4. ~~Testes com PostgreSQL real das travas, do P2002 e das restrições SQL.~~ Feito: testado em PostgreSQL 18 embutido (`npm run test:integration`); falta validar no 16 do docker-compose.

> Atualização (ADR 0010): a pendência "quem fez o quê" foi resolvida com login por funcionário e auditoria. Cancelar resgate agora exige o papel de gerente.
