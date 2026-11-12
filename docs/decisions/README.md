# Registro de decisões

Memória do projeto. Para alterar uma decisão: crie novo ADR e marque o antigo como "Substituída".

**Notas de atualização x nova decisão:**
- Dentro de um ADR é permitido acrescentar **notas factuais de atualização** (ex.: "testado em PostgreSQL real", "resolvido no ADR 0010", riscar uma pendência já feita), sempre datadas ou apontando o ADR que resolveu.
- **Mudar uma decisão** (regra, valor, comportamento) **nunca** se faz editando o ADR antigo: crie um novo ADR e marque o antigo como "Substituída" (ou anote no status a parte substituída).

| Nº | Título | Status |
|---|---|---|
| [0001](0001-estrutura-e-fluxo-de-trabalho.md) | Estrutura do projeto e fluxo de trabalho | Aceita |
| [0002](0002-stack-typescript-postgresql.md) | Stack: TypeScript + PostgreSQL | Aceita |
| [0003](0003-regras-de-pontos.md) | Regras de pontos, níveis e expiração | Aceita (mecânica); valores a confirmar com o hotel |
| [0004](0004-pms-erbon-e-elegibilidade.md) | PMS Erbon, elegibilidade e calibragem | Aceita |
| [0005](0005-cpf-obrigatorio.md) | CPF obrigatório no cadastro | Aceita |
| [0006](0006-api-e-protecao-de-documento.md) | API (Fastify) e proteção do CPF/passaporte | Aceita |
| [0007](0007-credito-de-pontos-no-checkout.md) | Crédito de pontos no check-out e estadias manuais | Aceita (autenticação por chave substituída pelo ADR 0010) |
| [0008](0008-rotina-noturna.md) | Rotina noturna: vencimento, nível e avisos | Aceita |
| [0009](0009-resgate-de-pontos.md) | Resgate de pontos, saldo e extrato | Aceita |
| [0010](0010-login-de-funcionarios-e-auditoria.md) | Login de funcionários, permissões e auditoria | Aceita |
| [0011](0011-correcoes-da-revisao-geral.md) | Correções da revisão geral | Aceita (item 8 substituído pelo ADR 0012) |
| [0012](0012-proxy-por-endereco-e-correcoes-da-auditoria.md) | Proxy por endereço e correções da auditoria | Aceita |
| [0013](0013-area-do-hospede.md) | Área do hóspede ("Minha conta") com código por e-mail | Aceita (limites, fontes e modo de teste ajustados pelo ADR 0014) |
| [0014](0014-correcoes-da-auditoria-da-area-do-hospede.md) | Correções da auditoria da área do hóspede | Aceita |
