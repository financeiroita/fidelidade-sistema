# AGENTS.md — guia para qualquer IA/pessoa que editar este projeto

Leia primeiro: `README.md`, depois `docs/decisions/README.md` (índice de decisões).

## Regras
1. **Decisões**: antes de mudar algo estrutural, consulte `docs/decisions/`. Se mudar uma decisão, não apague: crie um novo ADR que *substitui* o anterior e marque o antigo como `Substituída`. Notas factuais de atualização dentro de um ADR (ex.: "resolvido no ADR X") são permitidas.
2. **Novas decisões importantes** → novo arquivo `docs/decisions/NNNN-titulo.md` (use `0000-template.md`) e atualize o índice.
3. **Commits**: faça commit automaticamente após cada alteração relevante, em português, formato `tipo: resumo` (feat, fix, docs, refactor, chore, test). Commits pequenos e focados.
4. **Verificação**: após mudanças relevantes, proponha/rode o agente verificador (`docs/agents/verificador.md`); para segurança/dados/finanças, o auditor (`docs/agents/auditor.md`).
5. **Estrutura**: código em `src/`, testes em `tests/`, banco em `prisma/`, scripts em `scripts/`, docs em `docs/`, página do hóspede em `web/`; configurações de ferramentas de IA em `.claude/` e `.github/`. Não deixe arquivos soltos na raiz; a exceção são os arquivos de configuração de ferramentas, que precisam ficar lá (`package.json`, `package-lock.json`, `tsconfig.json`, `vitest*.config.ts`, `docker-compose.yml`, `.env.example`, `.editorconfig`, `.gitattributes`, `.gitignore`, `.cursorrules`, `CLAUDE.md`, `AGENTS.md`, `README.md`).
6. **Segredos**: nunca commitar `.env`, chaves ou dados pessoais de clientes. Use `.env.example`.
7. **Idioma**: documentação e commits em português (pt-BR); código/identificadores em inglês, salvo decisão contrária.
8. **Ao terminar uma sessão**: atualize `docs/STATUS.md` (o que foi feito, o que falta) e, se surgir pergunta para o hotel, `docs/perguntas-em-aberto.md`.

## Comandos de verificação
- **Sempre**, antes de dar uma mudança por pronta: `npm run typecheck` e `npm test`.
- **Também** `npm run test:integration` quando mexer em banco, migrações, repositórios Prisma (`src/infra/prisma`) ou em qualquer coisa com concorrência/travas. Sobe um PostgreSQL embutido; não precisa de Docker.

## Mapa de camadas
| Pasta | O que vai lá |
|---|---|
| `src/api` | HTTP (Fastify): rotas, validação de entrada, papéis exigidos, respostas |
| `src/application` | Casos de uso (orquestram domínio + repositórios); acessam o banco só por interfaces (`ports.ts`). Podem usar as funções puras de `src/infra/security` (hash, token) |
| `src/domain` | Regras puras, sem banco nem rede (pontos, níveis, estadias, CPF, senha) |
| `src/infra/memory` | Repositórios em memória, para os testes rápidos |
| `src/infra/prisma` | Repositórios reais (PostgreSQL via Prisma): transações e travas |
| `src/infra/security` | HMAC do documento, hash de senha, tokens, limitador |
| `src/jobs` | Scripts de linha de comando (rotina noturna, criar/destravar funcionário) |
| `src/config/loyalty.ts` | Todos os números do programa |
| `src/config/startup.ts` | Validações de partida do servidor (proxy, modo de teste, chave), sem efeitos colaterais |
| `src/env.ts` | Carrega o `.env`; é o primeiro import do servidor e dos comandos |
| `web/` | Página "Minha conta" do hóspede, servida pela API |
| `prisma/` | `schema.prisma`, `migrations/` e `seed.ts` |

## Migrações do banco
- Mudou o `schema.prisma`? Gere uma migração nova: `npx prisma migrate dev --name descricao_curta`.
- **Nunca** edite uma migração que já foi commitada; corrija com outra migração.
- Restrições SQL (CHECK, índices especiais etc.) vão **dentro de uma migração**, não em arquivo solto aplicado à mão.
- **Nunca** use `prisma db push` (muda o banco sem deixar migração).

## Regras transversais do código
- **Ordem das travas**: em toda transação, trave **primeiro o hóspede e depois os lotes** de pontos (evita impasse/deadlock).
- **Saldo utilizável** = soma do que resta nos lotes ainda válidos (`remaining > 0` e não vencidos), nunca a soma simples dos lançamentos.
- **Datas de lançamento** vêm do relógio da aplicação (`now` injetado nos casos de uso), não do `now()` do banco, para os testes controlarem o tempo.
- **"Hoje" do hotel** é calculado no fuso `America/Sao_Paulo` (`loyaltyConfig.timeZone`).
- **Nunca** grave dados pessoais do hóspede (nome, CPF, e-mail, telefone) nem senhas ou a mensagem de erro do banco em log ou auditoria; só ids, códigos e contagens. A auditoria guarda o nome do funcionário que fez a ação (ADR 0010).
- **Validade dos pontos**: valem até o fim do dia do hotel (`expirationDate`); para mostrar ao hóspede use `lastValidDay` (ADR 0016).
- **Nível que vale agora**: sempre `effectiveTierRank` (check-out, resgate e "Minha conta" usam a mesma regra, ADR 0016).
- **Números do programa** (pontos por real, limiares, validade, bônus) só em `src/config/loyalty.ts`; nada de número mágico espalhado.

## Nomes de pastas e arquivos de documentação
- Pastas de `docs/` em português, minúsculas e com hífen, sem acento (ex.: `docs/comunicacao/`, `docs/decisions/` é a exceção histórica).
- ADRs: `docs/decisions/NNNN-titulo-com-hifens.md`, numeração sequencial de 4 dígitos.
- Arquivos de documentação: minúsculas com hífen (ex.: `perguntas-em-aberto.md`); exceções: `README.md` e `STATUS.md`.

Arquivos equivalentes para ferramentas específicas apontam para este: `CLAUDE.md`, `.github/copilot-instructions.md`, `.cursorrules`.
