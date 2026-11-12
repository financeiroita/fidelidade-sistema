# 0006 — API (Fastify) e proteção do CPF/passaporte

- **Status**: Aceita
- **Data**: 2026-11-11

## Decisão
- API em Fastify 5 com validação por zod. Camadas: `src/api` (HTTP), `src/application` (casos de uso), `src/domain` (regras puras), `src/infra` (Prisma, memória, segurança). O caso de uso depende de uma interface (`GuestRepository`), o que permite testar sem banco.
- Primeiro endpoint: `POST /guests` (cadastro). Respostas: 201 criado, 409 duplicado (CPF ou e-mail), 422 validação.
- **CPF/passaporte nunca fica em claro.** `Guest.document` guarda um HMAC-SHA256 com chave secreta (`DOCUMENT_HASH_SECRET`); `documentLast4` guarda só os 4 últimos caracteres para exibição. O hash é determinístico, então serve para unicidade e para casar com o CPF vindo do Erbon.
- Limitação: HMAC não é reversível. Se for preciso exibir ou exportar o CPF completo, é necessária uma decisão nova (criptografia reversível). A chave não pode ser trocada sem recalcular todos os hashes.
- Boas-vindas por indicação (500 pontos) **não são creditadas no cadastro**: ficam em `Guest.welcomeBonusPending` e só viram pontos (lote de 24 meses) após o 1º check-out confirmado do próprio hóspede, para desestimular contas falsas. O crédito acontece no fluxo de check-out (implementado no ADR 0007). O bônus do indicador (1.000) segue a mesma regra.
- Indicação com código inexistente não bloqueia o cadastro.
- Marketing exige consentimento explícito (padrão: falso). Aceite do regulamento é obrigatório.

## Pendências de segurança antes de ir ao ar
- Limite de requisições (rate limit) e proteção contra robôs no cadastro.
- HTTPS e CORS restrito ao site do hotel; autenticação para os endpoints internos.
- A resposta 409 confirma que um CPF/e-mail já existe; avaliar risco de enumeração.

## Auditoria de 2026-11-11
Corrigido: data de nascimento impossível (ex.: 31/02), colisão do código de indicação (agora tenta de novo em vez de responder 409), formato do passaporte (hífen e espaços ignorados na comparação), telefone com dígitos repetidos, e checagem dos níveis na inicialização do servidor.

Em aberto, aguardando decisão do hotel (abuso e LGPD):
1. **Farming de pontos por indicação** (alto; DECIDIDO: boas-vindas só após o 1º check-out; restam rate limit, anti-robô e limite de indicações por código): cadastros falsos em cadeia geram 500 pontos cada. Opções: liberar os pontos de boas-vindas só após o 1º check-out; confirmar e-mail; limitar indicações por código; rate limit e anti-robô (bloqueantes antes de abrir o cadastro ao público).
2. **Código de indicação adivinhável** (alto): sufixo de 4 caracteres e primeiro nome no prefixo. Aumentar o sufixo e não revelar se o código existe.
3. **Idade mínima** (LGPD, menores): exigir maioridade ou responsável?
4. **Anonimização**: definir como apagar documento, e-mail, telefone e nome de quem pedir exclusão, liberando o recadastro.
5. **Consentimento**: registrar versão do regulamento e data do consentimento de marketing em separado.
6. **Chave do HMAC**: exigir segredo aleatório de 32 bytes, guardar versão da chave; avaliar criptografia reversível se o hotel precisar ver o CPF.
7. ~~Testes de integração do repositório Prisma contra um PostgreSQL real.~~ Feito: testado em PostgreSQL 18 embutido (`npm run test:integration`); falta validar no 16 do docker-compose.

> Atualização (ADR 0010): a autenticação das rotas internas foi implementada (login por funcionário, papéis, auditoria) e o limite de requisições por IP foi adicionado ao login, à troca de senha e ao cadastro público. Seguem pendentes: HTTPS e acesso restrito ao site do hotel (CORS), e a proteção contra robôs no cadastro.
