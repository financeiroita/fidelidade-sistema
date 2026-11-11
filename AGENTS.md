# AGENTS.md — guia para qualquer IA/pessoa que editar este projeto

Leia primeiro: `README.md`, depois `docs/decisions/README.md` (índice de decisões).

## Regras
1. **Decisões**: antes de mudar algo estrutural, consulte `docs/decisions/`. Se mudar uma decisão, não apague: crie um novo ADR que *substitui* o anterior e marque o antigo como `Substituída`.
2. **Novas decisões importantes** → novo arquivo `docs/decisions/NNNN-titulo.md` (use `0000-template.md`) e atualize o índice.
3. **Commits**: faça commit automaticamente após cada alteração relevante, em português, formato `tipo: resumo` (feat, fix, docs, refactor, chore, test). Commits pequenos e focados.
4. **Verificação**: após mudanças relevantes, proponha/rode o agente verificador (`docs/agents/verificador.md`); para segurança/dados/finanças, o auditor (`docs/agents/auditor.md`).
5. **Estrutura**: código em `src/`, testes em `tests/`, scripts em `scripts/`, docs em `docs/`. Não deixe arquivos soltos na raiz.
6. **Segredos**: nunca commitar `.env`, chaves ou dados pessoais de clientes. Use `.env.example`.
7. **Idioma**: documentação e commits em português (pt-BR); código/identificadores em inglês, salvo decisão contrária.
8. **Ao terminar uma sessão**: atualize `docs/STATUS.md` (o que foi feito, o que falta).

Arquivos equivalentes para ferramentas específicas apontam para este: `CLAUDE.md`, `.github/copilot-instructions.md`, `.cursorrules`.
