# 0007 — Crédito de pontos no check-out e lançamento manual de estadias

- **Status**: Aceita (autenticação por chave substituída pelo ADR 0010)
- **Data**: 2026-11-11

## Decisão
- Rotas internas, protegidas por chave no cabeçalho `x-api-key` (`INTERNAL_API_KEY`) (nota: substituído pelo login por funcionário do ADR 0010; a chave não existe mais):
  - `POST /stays` lança uma estadia manualmente (recepção), com o folio por categoria. Não gera pontos.
  - `POST /stays/:id/checkout` credita os pontos. Repetir a chamada não credita de novo (idempotente).
- Cálculo (`planCheckout`, função pura): pontos pelo nível vigente no check-out; bônus de reserva direta só para os canais site, telefone, WhatsApp e balcão (OTA, agência e corporativo não); estornos não geram pontos negativos; lotes com validade de 24 meses.
- **Primeiro check-out com receita** (o primeiro que gera pontos de diária ou consumo): libera as boas-vindas pendentes do hóspede indicado (500) e paga o indicador (1.000). Estadia sem receita não conta como primeira.
- Nível: sobe no check-out se os pontos qualificáveis dos últimos 12 meses atingirem o limiar. Descer (expiração do nível) fica para uma tarefa noturna, a implementar.
- Garantia de crédito único: a estadia é "reivindicada" no próprio UPDATE (`pointsProcessedAt IS NULL`) dentro da transação, e as chaves de idempotência dos lançamentos são únicas no banco.
- Cancelada ou no-show: check-out recusado (409).

## Limitações conhecidas
- ~~A rotina de check-out com o PostgreSQL real ainda não foi testada.~~ Testado em PostgreSQL 18 embutido (`npm run test:integration`); falta validar no 16 do docker-compose.
- (Atualizado) A rotina noturna e o nível vencido foram implementados no ADR 0008.
- ~~A chave interna é única e compartilhada; sem usuários individuais nem registro de quem lançou.~~ Resolvido no ADR 0010 (login por funcionário e auditoria).
- ~~Rotina noturna: expiração de pontos, rebaixamento de nível e aviso de vencimento ainda não existem.~~ Resolvido no ADR 0008 (o envio dos avisos continua pendente).
- Importação automática do Erbon continua pendente (levantar a API).

## Auditoria de 2026-11-11
Corrigido:
- Check-outs simultâneos de estadias diferentes do mesmo hóspede: o hóspede é travado na transação (`FOR UPDATE`), e se o crédito perder a corrida o sistema recarrega os dados e recalcula (até 3 tentativas), em vez de responder "já processado" sem ter creditado.
- Lançamento duplicado: `externalRef` opcional (identificador único do lançamento); sem ele, o mesmo hóspede com as mesmas datas é recusado (409).
- Check-out de estadia futura é recusado; datas limitadas a 5 anos atrás e 1 ano à frente.
  - Nota (2026-11-12): para lançamento manual, o limite real passou a ser saída nos últimos 30 dias e não antes do cadastro (ADR 0011). Os 5 anos continuam como validação de formato.
- Valores com no máximo 2 casas; teto de R$ 200.000 por linha, R$ 500.000 por estadia e 100 linhas; soma em centavos inteiros (sem perder ponto por ponto flutuante).
- Nível não regride por check-out concorrente; manter o nível renova a validade (`tierValidUntil`).
- Chaves secretas exigem variedade de caracteres; logs de erro não incluem mensagens do banco; `id` do check-out é validado.

Decisões do hotel em aberto:
1. ~~Pontos qualificáveis com ou sem multiplicador?~~ DECIDIDO: só valor base, sem multiplicador (coluna `qualifyingPts`). Os limiares de nível passam a ser em pontos-base, ou seja, equivalem ao valor gasto em reais.
2. **Estorno depois do check-out:** hoje só se compensa estorno lançado antes do check-out e na mesma categoria. Falta rota de estorno que reduza os pontos já creditados (tipo REVERSAL).
3. ~~Nível vencido~~: resolvido no ADR 0008 (rotina noturna) e no check-out, que ignora o multiplicador de nível vencido.

Segurança ainda pendente: ~~usuário individual por funcionário e registro de quem lançou (`createdBy`)~~ (resolvido no ADR 0010); limite de requisições nas rotas internas; restringir essas rotas por rede/IP.

> Atualização (ADR 0010): a chave interna única foi substituída por login por funcionário, com papéis e auditoria.
