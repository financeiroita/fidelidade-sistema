# 0002 — Stack: TypeScript + PostgreSQL

- **Status**: Aceita
- **Data**: 2026-11-11

## Contexto
CRM + fidelidade para um hotel/resort de lazer único. Estadias virão de um PMS via API e também de lançamento manual.

## Decisão
- TypeScript (Node LTS), PostgreSQL, Prisma (ORM/migrações), Vitest (testes), Docker Compose para o banco local.
- Regras de negócio como **funções puras** em `src/domain/` (sem acesso a banco), para serem testáveis e auditáveis.
- Razão de pontos (*ledger*) imutável: saldo = soma das transações; nunca editar, só estornar.
- Hotel único agora; sem `propertyId` nas tabelas (adicionar via novo ADR se virar rede).
- Estadias têm `source` (PMS ou MANUAL) e `pmsReservationId` único para importação idempotente.

## Consequências
Fácil integrar PMS via adaptadores em `src/infra/pms/` (a criar).

## Atualização (2026-11-12): testes em PostgreSQL real e migrações
- Primeira migração criada em `prisma/migrations` (`init`) e as restrições de integridade viraram a migração `constraints` (antes era `prisma/constraints.sql`, aplicado à mão).
- `npm run test:integration` usa o pacote `embedded-postgres` (PostgreSQL 18 temporário, sem Docker) para provar travas de linha, restrições, P2002 e concorrência. O `docker-compose.yml` segue com PostgreSQL 16: validar nele antes de ir para produção.
