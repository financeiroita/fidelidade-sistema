# 0006 — API (Fastify) e proteção do CPF/passaporte

- **Status**: Aceita
- **Data**: 2026-11-11

## Decisão
- API em Fastify 5 com validação por zod. Camadas: `src/api` (HTTP), `src/application` (casos de uso), `src/domain` (regras puras), `src/infra` (Prisma, memória, segurança). O caso de uso depende de uma interface (`GuestRepository`), o que permite testar sem banco.
- Primeiro endpoint: `POST /guests` (cadastro). Respostas: 201 criado, 409 duplicado (CPF ou e-mail), 422 validação.
- **CPF/passaporte nunca fica em claro.** `Guest.document` guarda um HMAC-SHA256 com chave secreta (`DOCUMENT_HASH_SECRET`); `documentLast4` guarda só os 4 últimos caracteres para exibição. O hash é determinístico, então serve para unicidade e para casar com o CPF vindo do Erbon.
- Limitação: HMAC não é reversível. Se for preciso exibir ou exportar o CPF completo, é necessária uma decisão nova (criptografia reversível). A chave não pode ser trocada sem recalcular todos os hashes.
- Boas-vindas por indicação (500 pontos) são creditadas no cadastro, em lote com validade de 24 meses. O bônus do indicador (1.000 pontos) só sai após o primeiro check-out do indicado (a implementar).
- Indicação com código inexistente não bloqueia o cadastro.
- Marketing exige consentimento explícito (padrão: falso). Aceite do regulamento é obrigatório.

## Pendências de segurança antes de ir ao ar
- Limite de requisições (rate limit) e proteção contra robôs no cadastro.
- HTTPS e CORS restrito ao site do hotel; autenticação para os endpoints internos.
- A resposta 409 confirma que um CPF/e-mail já existe; avaliar risco de enumeração.
