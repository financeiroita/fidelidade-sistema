# Fidelidade

Projeto Fidelidade (Itamambuca). Descrição, stack e objetivos: ainda a definir — ver `docs/decisions/`.

## Estrutura
| Pasta | Conteúdo |
|---|---|
| `src/` | Código-fonte |
| `tests/` | Testes |
| `scripts/` | Automação (setup, utilitários) |
| `docs/` | Documentação |
| `docs/decisions/` | Registro de decisões (ADRs) — memória do projeto |
| `docs/agents/` | Papéis de agentes verificadores/auditores |
| `.claude/agents/` | Subagentes do Claude Code |

## Começando em outro computador
```bash
git clone <URL-do-repositorio> Fidelidade
cd Fidelidade
scripts/setup.sh   # ou scripts\setup.ps1 no Windows
```
Leia `AGENTS.md` antes de editar (vale para qualquer IA).

## Desenvolvimento
Requer Node 20+ e Docker (PostgreSQL local).
```bash
npm install
cp .env.example .env
npm run db:up && npm run db:migrate
npm test
```
Modelo de dados: `prisma/schema.prisma` e `docs/modelo-de-dados.md`. Regras: `docs/decisions/0003-regras-de-pontos.md`.

## API
```bash
cp .env.example .env     # preencha DOCUMENT_HASH_SECRET (>= 32 caracteres)
npm run db:up && npm run db:migrate && npm run db:seed
npm run operator:create -- --username SEU_USUARIO --name "Seu Nome" --role ADMIN
npm run dev              # http://localhost:3000
```
`POST /guests` cadastra um hóspede (corpo: ver `src/domain/guests/signup.ts`). `GET /health` verifica a API.

### Rotas internas (recepção): exigem login
Exigem `Authorization: Bearer <token>` (token do `POST /auth/login`). Crie o primeiro administrador com `npm run operator:create` (ADR 0010).
- `POST /stays`: lança a estadia e o folio por categoria. Corpo: ver `src/domain/stays/stay.ts`.
- `POST /stays/:id/checkout`: credita os pontos (uma única vez por estadia).

### Rotina diária
`npm run job:nightly` vence pontos, revisa níveis e gera os avisos de vencimento. Agende uma vez por dia (ver ADR 0008).

### Prêmios, saldo e extrato
- `GET /rewards` (público): catálogo ativo. `POST /rewards` (interno): cadastra prêmio.
- `POST /redemptions` e `POST /redemptions/:id/{confirm,use,cancel}` (internos): resgate e ciclo.
- `GET /guests/:id/balance` e `GET /guests/:id/statement` (internos): saldo e extrato.

Depois da primeira migração, aplique também as restrições de integridade: `psql "$DATABASE_URL" -f prisma/constraints.sql`.

Se a conta de administrador for desativada ou travada e ninguém mais conseguir entrar: `npm run operator:unlock -- --username SEU_USUARIO`.
