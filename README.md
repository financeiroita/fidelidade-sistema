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
npm run dev              # http://localhost:3000
```
`POST /guests` cadastra um hóspede (corpo: ver `src/domain/guests/signup.ts`). `GET /health` verifica a API.
