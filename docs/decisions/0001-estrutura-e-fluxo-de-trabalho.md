# 0001 — Estrutura do projeto e fluxo de trabalho

- **Status**: Aceita
- **Data**: 2026-11-11

## Contexto
Projeto novo, será editado por várias IAs e em vários computadores.

## Decisão
- Git + GitHub como fonte da verdade; branch principal `main`.
- `AGENTS.md` é o guia único para IAs; `CLAUDE.md`, Copilot e Cursor apontam para ele.
- Decisões registradas como ADRs em `docs/decisions/` (nunca apagadas, só substituídas).
- Commits automáticos a cada alteração importante, mensagens em pt-BR (`tipo: resumo`).
- Agente verificador e auditor propostos sempre que apropriado (`docs/agents/`).
- Pastas: `src/`, `tests/`, `scripts/`, `docs/`.
- Stack ainda não escolhida (decidir em ADR futuro).

## Consequências
Qualquer pessoa/IA consegue retomar o trabalho lendo README, AGENTS e ADRs.
