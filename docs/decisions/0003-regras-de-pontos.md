# 0003 — Regras de pontos, níveis e expiração (valores iniciais)

- **Status**: Aceita (mecânica); valores a confirmar com o hotel
- **Data**: 2026-11-11

Todos os números ficam em `src/config/loyalty.ts`; alterar lá e registrar novo ADR.

## Acúmulo (creditado no check-out)
- Base: **1 ponto por R$ 1** de diária (líquida de impostos/taxas), multiplicada pelo multiplicador do nível.
- Gastos extras no folio, por categoria: A&B 1 pt/R$, SPA 1 pt/R$, Eventos 0,5 pt/R$, Outros 0 (multiplicador do nível também se aplica).
- **Bônus reserva direta** (site/telefone/WhatsApp/balcão): +20% sobre os pontos base da diária.
- **Aniversário**: 500 pontos no mês do aniversário (1x/ano; só com estadia concluída nos últimos 24 meses).
- **Indicação**: indicado ganha 500 pontos de boas-vindas **após o seu 1º check-out** (decisão 2026-11-11, ADR 0006); indicador ganha 1.000 após o 1º check-out do indicado.
- **Campanhas**: bônus por período/regra (ex.: baixa temporada +50%), tabela Campaign.
- Cancelamento/no-show: sem pontos. Estorno/reembolso no folio: estorno proporcional.
  - Nota (2026-11-12): hoje o "estorno proporcional" só existe **antes do check-out** (o estorno lançado no folio reduz o valor que pontua, na mesma categoria). Estorno depois do check-out ainda não foi implementado; ver `docs/perguntas-em-aberto.md`.
- Nota (2026-11-12): aniversário e campanhas estão descritos aqui, mas ainda não foram implementados no sistema.
- Hipótese assumida: diárias também pontuam (o cliente listou só extras e bônus). Confirmar.

## Níveis (pontos-base em 12 meses móveis; DECIDIDO em 2026-11-11: conta só o valor base, sem multiplicador do nível; bônus não qualificam)
| Nível | Mín. pts qualificáveis | Multiplicador |
|---|---|---|
| Bronze | 0 | 1,00 |
| Prata | 3.000 | 1,25 |
| Ouro | 8.000 | 1,50 |
| Diamante | 20.000 | 2,00 |

Nível vale por 12 meses após ser atingido (tierValidUntil); reavaliado a cada check-out e diariamente.
Benefícios por nível (late check-out, upgrade, welcome drink etc.) ficam em Tier.benefits.

## Expiração
- Cada crédito é um *lote* que expira **24 meses** após o crédito; consumo **FIFO** (vence primeiro, gasta primeiro).
- Avisos ao cliente 90 e 30 dias antes (marketing).
- Job diário gera transações EXPIRE.

## Resgate
- Catálogo Reward com custo em pontos (diária grátis, upgrade, jantar, spa, desconto na fatura).
- Referência de valor: 1 ponto ≈ R$ 0,02 (retorno ~2%); ajustar o custo dos prêmios a essa relação.
- Resgate exige saldo disponível; status PENDING → CONFIRMED → USED, ou CANCELLED (devolve pontos).
