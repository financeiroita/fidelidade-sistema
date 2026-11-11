# 0007 — Crédito de pontos no check-out e lançamento manual de estadias

- **Status**: Aceita
- **Data**: 2026-11-11

## Decisão
- Rotas internas, protegidas por chave no cabeçalho `x-api-key` (`INTERNAL_API_KEY`):
  - `POST /stays` lança uma estadia manualmente (recepção), com o folio por categoria. Não gera pontos.
  - `POST /stays/:id/checkout` credita os pontos. Repetir a chamada não credita de novo (idempotente).
- Cálculo (`planCheckout`, função pura): pontos pelo nível vigente no check-out; bônus de reserva direta só para os canais site, telefone, WhatsApp e balcão (OTA, agência e corporativo não); estornos não geram pontos negativos; lotes com validade de 24 meses.
- **Primeiro check-out com receita** (o primeiro que gera pontos de diária ou consumo): libera as boas-vindas pendentes do hóspede indicado (500) e paga o indicador (1.000). Estadia sem receita não conta como primeira.
- Nível: sobe no check-out se os pontos qualificáveis dos últimos 12 meses atingirem o limiar. Descer (expiração do nível) fica para uma tarefa noturna, a implementar.
- Garantia de crédito único: a estadia é "reivindicada" no próprio UPDATE (`pointsProcessedAt IS NULL`) dentro da transação, e as chaves de idempotência dos lançamentos são únicas no banco.
- Cancelada ou no-show: check-out recusado (409).

## Limitações conhecidas
- A rotina de check-out com o PostgreSQL real ainda não foi testada (os testes usam o repositório em memória).
- A chave interna é única e compartilhada; sem usuários individuais nem registro de quem lançou. Avaliar autenticação por usuário antes de dar acesso à recepção.
- Rotina noturna: expiração de pontos, rebaixamento de nível e aviso de vencimento ainda não existem.
- Importação automática do Erbon continua pendente (levantar a API).
