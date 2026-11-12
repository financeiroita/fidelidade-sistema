# Fidelidade

CRM e programa de fidelidade do resort Itamambuca: cadastra hóspedes (com CPF protegido), credita pontos no check-out, controla níveis, vencimento e resgate de pontos, com login por funcionário e registro de auditoria.
Estado atual (2026-11-12): o núcleo do programa funciona e está testado, inclusive em PostgreSQL de verdade; ainda falta integrar com o Erbon, enviar os avisos e outras pendências listadas em `docs/STATUS.md`. Decisões em `docs/decisions/`.

## Estrutura
| Pasta | Conteúdo |
|---|---|
| `src/` | Código-fonte (camadas descritas em `AGENTS.md`) |
| `tests/` | Testes |
| `prisma/` | Modelo do banco (`schema.prisma`), migrações (`migrations/`) e carga inicial dos níveis (`seed.ts`) |
| `scripts/` | Automação (setup, utilitários) |
| `docs/` | Documentação |
| `docs/decisions/` | Registro de decisões (ADRs) — memória do projeto |
| `docs/agents/` | Papéis de agentes verificadores/auditores |
| `docs/comunicacao/` | Textos e páginas para hóspedes (rascunhos) |
| `web/` | Página "Minha conta" do hóspede, servida pela API em `/minha-conta` |
| `.claude/agents/` | Subagentes do Claude Code |

Leia `AGENTS.md` antes de editar (vale para qualquer IA).

## Instalação passo a passo
1. **Node 20 ou mais novo** instalado. Depois de clonar o repositório, rode o preparo do Git:
   - Windows: `powershell -ExecutionPolicy Bypass -File scripts\setup.ps1`
   - Linux/Mac: `scripts/setup.sh`
2. Instale as dependências: `npm install`
3. Copie `.env.example` para `.env` e gere a chave do CPF:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```
   Cole o resultado em `DOCUMENT_HASH_SECRET=` no `.env`.
   **Atenção:** use a **mesma** chave em todo computador que usa o mesmo banco, e nunca troque depois (os CPFs gravados deixariam de ser reconhecidos). Guarde a chave num cofre de senhas.
4. Banco de dados (escolha uma opção):
   - **Opção A — Docker:** `npm run db:up` (sobe o PostgreSQL 16 do `docker-compose.yml`).
   - **Opção B — PostgreSQL 16 instalado no Windows:** no pgAdmin ou no `psql` como administrador, crie o usuário `fidelidade` com senha `fidelidade_dev` e permissão `CREATEDB`, e o banco `fidelidade` com esse dono:
     ```sql
     CREATE USER fidelidade WITH PASSWORD 'fidelidade_dev' CREATEDB;
     CREATE DATABASE fidelidade OWNER fidelidade;
     ```
     (`CREATEDB` é necessário porque o Prisma cria um banco temporário ao gerar migrações.)
5. Crie as tabelas: `npm run db:migrate`
6. Carregue os níveis: `npm run db:seed`
7. Crie o primeiro administrador (a senha é pedida no terminal):
   `npm run operator:create -- --username SEU_USUARIO --name "Seu Nome" --role ADMIN`
8. Suba a API: `npm run dev` (http://localhost:3000)

Em produção, as migrações são aplicadas com `npx prisma migrate deploy` (já incluem as restrições de integridade do banco).

**Ver a área do hóspede sem banco:** `npm run demo:minha-conta` e abra http://localhost:3100/minha-conta com o e-mail `demo@exemplo.com`. O código de acesso aparece no terminal; tudo fica só na memória.

**Só testes:** `npm install && npm test` (rápidos, sem banco). Com banco real temporário: `npm run test:integration` (sobe um PostgreSQL embutido; não precisa de Docker nem do passo 4).

## Rotas da API
Rotas internas exigem `Authorization: Bearer <token>` (token do `POST /auth/login`). Papéis: `RECEPTION` < `MANAGER` < `ADMIN`; o papel mais alto pode tudo o que o mais baixo pode (ADR 0010).

| Rota | Para quê | Papel mínimo |
|---|---|---|
| `GET /health` | Verifica se a API está no ar | público |
| `POST /guests` | Cadastro do hóspede (corpo: `src/domain/guests/signup.ts`) | público |
| `GET /rewards` | Catálogo de prêmios ativos | público |
| `POST /auth/login` | Entrar (devolve o token) | público |
| `GET /minha-conta` | Página do hóspede (ADR 0013) | público |
| `POST /me/login/request` | Hóspede pede o código de acesso (responde 202 sempre) | público |
| `POST /me/login/verify` | Hóspede troca e-mail + código por um token de hóspede | público |
| `GET /me`, `GET /me/statement`, `GET /me/rewards` | Resumo, extrato e prêmios do próprio hóspede | hóspede logado |
| `POST /me/logout` | Hóspede sai | hóspede logado |
| `GET /auth/me` | Quem está logado | qualquer funcionário logado |
| `POST /auth/logout` | Sair | qualquer funcionário logado |
| `POST /auth/password` | Trocar a própria senha | qualquer funcionário logado |
| `POST /stays` | Lançar estadia e folio por categoria (corpo: `src/domain/stays/stay.ts`) | RECEPTION |
| `POST /stays/:id/checkout` | Creditar os pontos (uma única vez por estadia) | RECEPTION |
| `POST /redemptions` | Pedir resgate | RECEPTION |
| `POST /redemptions/:id/confirm` | Confirmar resgate | RECEPTION |
| `POST /redemptions/:id/use` | Marcar resgate como usado | RECEPTION |
| `POST /redemptions/:id/cancel` | Cancelar resgate (devolve pontos) | MANAGER |
| `GET /guests/:id/balance` | Saldo do hóspede | RECEPTION |
| `GET /guests/:id/statement` | Extrato do hóspede | RECEPTION |
| `POST /rewards` | Cadastrar prêmio | MANAGER |
| `PATCH /rewards/:id` | Alterar ou retirar prêmio | MANAGER |
| `GET /audit` | Consultar a auditoria | MANAGER |
| `GET /operators` | Listar funcionários | ADMIN |
| `POST /operators` | Criar funcionário | ADMIN |
| `POST /operators/:id/activate` e `/deactivate` | Ativar ou desativar funcionário | ADMIN |
| `POST /operators/:id/password` | Redefinir senha de outro funcionário | ADMIN |

## Rotina diária
`npm run job:nightly` vence pontos, revisa níveis, grava os avisos de vencimento e apaga sessões vencidas. Agende uma vez por dia, de madrugada (ver ADR 0008).

## Configuração (`.env`)
- `DATABASE_URL`: endereço do banco.
- `DOCUMENT_HASH_SECRET`: chave do CPF (passo 3).
- `PORT`: porta da API (padrão 3000).
- `TRUST_PROXY_ADDRS`: **só** quando o servidor estiver atrás de um proxy ou balanceador **seu** (ex.: Nginx, balanceador da nuvem). É o endereço desse proxy, ou a faixa de endereços dele (ex.: `127.0.0.1` se o Nginx roda na mesma máquina, ou `10.0.0.0/8`), separados por vírgula. Assim a API enxerga o IP real do visitante no limite de tentativas. Só pedidos vindos desses endereços podem informar o IP; quem conecta direto não consegue falsificá-lo. As antigas `TRUST_PROXY` e `TRUST_PROXY_HOPS` não valem mais: o servidor não inicia se encontrar uma delas (ADR 0012).

- `GUEST_CODE_DELIVERY`: como o código de acesso da "Minha conta" chega ao hóspede. Hoje só existe `console` (o código aparece no terminal; **só para testes**, recusado com `NODE_ENV=production`). Sem a variável, o login do hóspede responde 503 até o hotel escolher o serviço de e-mail (pergunta 29).

## Erros comuns da API
| Código | Erro | Quando |
|---|---|---|
| 409 | `duplicate_stay` | Estadia repetida: mesmo número de reserva, ou período sobreposto a outra estadia do hóspede (a não ser que as duas tenham número) |
| 422 | `stay_out_of_period` | Estadia terminou antes do cadastro, ou check-out há mais de 30 dias (ADR 0011) |
| 409 | `stay_not_eligible` | Check-out ainda não aconteceu, estadia cancelada/no-show ou hóspede excluído |
| 401 | `invalid_code` | Código do hóspede errado, vencido, já usado ou queimado (resposta sempre igual) |
| 503 | `guest_login_unavailable` | Envio de código não configurado (`GUEST_CODE_DELIVERY`) |
| 429 | `too_many_requests` | Limite de tentativas por IP |

## Emergência
Se a conta de administrador for desativada ou travada e ninguém mais conseguir entrar: `npm run operator:unlock -- --username SEU_USUARIO`.
