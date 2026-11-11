# Status do projeto

_Atualizado: 2026-11-11_

- Feito: ADRs 0001-0006; schema Prisma; regras de pontos/níveis/expiração (testadas); páginas de demonstração (programa e cadastro em docs/comunicacao/); API `POST /guests` com CPF protegido por HMAC (25 testes passando, repositório em memória).
- Auditoria da API feita; correções técnicas aplicadas (29 testes). Itens em aberto no fim do ADR 0006.
- Não verificado: repositório Prisma contra um PostgreSQL real (sem migração nem Docker rodando).
- Feito: crédito de pontos no check-out e estadias manuais (ADR 0007, auditado, 45 testes).
- Pendente: rotina noturna (expirar pontos, rebaixar nível, avisos); resgates; saldo e extrato; criar migração e testar com banco; auditoria de segurança (ADR 0006); rate limit/CORS; levantar API do Erbon; crédito de pontos no check-out; bônus do indicador; jobs de expiração e aniversário; GitHub (`gh auth login`).
- Decisões do hotel em aberto: `docs/perguntas-em-aberto.md`.
