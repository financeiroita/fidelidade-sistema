# Status do projeto

_Atualizado: 2026-11-12_

## Feito
- Cadastro de hóspede com CPF obrigatório e protegido (HMAC, só os 4 últimos dígitos à vista) (ADRs 0005 e 0006).
- Crédito de pontos no check-out e lançamento manual de estadias pela recepção (ADR 0007).
- Rotina noturna: vencimento de pontos, revisão de nível e gravação dos avisos de vencimento (ADR 0008).
- Resgate de pontos, catálogo de prêmios, saldo e extrato (ADR 0009).
- Login por funcionário, papéis (recepção, gerente, administrador) e registro de auditoria (ADR 0010).
- Área do hóspede "Minha conta" (`/minha-conta`): entrada por código no e-mail, saldo, nível, progresso, vencimentos, extrato e prêmios (ADRs 0013 e 0014). Demonstração sem banco: `npm run demo:minha-conta`.
- Testes: 177 rápidos (`npm test`, sem banco) e 36 de integração com PostgreSQL de verdade (`npm run test:integration`, versão 18 embutida, sem Docker).
- Correções da revisão geral de 2026-11-12 e da auditoria seguinte (ver ADRs 0011 e 0012).
- Segunda revisão geral (ADR 0016): pontos valem até o fim do dia do hotel, número da reserva sem diferença de maiúsculas, regra única para nível vencido, `.env` carregado pelo próprio sistema e mais travas de integridade no banco. A auditoria seguinte (ADR 0017) estendeu o fim do dia à validade do nível e fechou uma brecha no limite do proxy.

- Publicado no GitHub, em repositório **privado**: https://github.com/financeiroita/fidelidade-sistema (2026-11-15). Mudar para a organização Itamambuca-Eco-Resort é uma pendência de quem administra a organização.

## Pendente técnico
- Ligar um serviço de e-mail de verdade para o código de acesso da "Minha conta" (depende da pergunta 29).
- Ligar o formulário de cadastro (`docs/comunicacao/cadastro-hospede.html`) à API; hoje ele é só demonstração.
- Envio dos avisos de vencimento (hoje só são gravados).
- Bônus de aniversário.
- Campanhas.
- Estorno de pontos depois do check-out.
- Cancelamento e no-show de estadia já lançada.
- Direitos LGPD do hóspede: acesso, correção e anonimização.
- Confirmação do e-mail/CPF no cadastro (hoje o cadastro revela se alguém já é hóspede).
- Adaptador do Erbon (levantar a API primeiro).
- CORS restrito ao site do hotel, HTTPS e proteção contra robôs no cadastro.
- Validar no PostgreSQL 16 do `docker-compose.yml` (os testes rodam no 18).
- Teste de integração: às vezes o Vitest avisa "something prevents Vite server from exiting" e deixa um processo filho (`io_worker`) do PostgreSQL embutido para trás (visto em 2026-11-13). Não afeta os resultados nem a porta (ela é sorteada), mas vale melhorar o encerramento em `tests/integration/globalSetup.ts`. Se acontecer, encerre o `postgres.exe` da pasta `node_modules` do projeto.
- Regra de day use quando as estadias vierem do Erbon (ADR 0012).
- Limite de requisições e restrição por rede nas rotas internas (ADR 0007); limite por IP agrupando IPv6 por `/64`; tempo limite de transação respondendo 503 (ADR 0016).
- Lista grande de senhas vazadas na criação de senha de funcionário (ADR 0010).
- Chave estrangeira em `Redemption.stayId` e preenchimento de `PointsTransaction.createdBy` (ADR 0016).
- Sem teste automatizado: `web/minha-conta.js`, a calculadora de `programa-fidelidade.html` e os scripts `operator:create`/`operator:unlock`.
- Antes de publicar as páginas de `docs/comunicacao/`: torná-las páginas completas e tirar as fontes do Google.

## Proposto, aguardando o hotel
- Instagram: pontos por marcação do hotel em post, reels ou story, com vínculo da conta e aprovação do marketing (ADR 0015, perguntas 34 a 40). Seguir e curtir não podem pontuar.
- Ideias da pesquisa de programas de resorts (`docs/pesquisa-programas-de-resorts.md`, perguntas 41 a 48): diária grátis por marco de noites, pontos pagando parte da conta, vencimento por inatividade, janela de nível maior, dias do membro, experiências locais, benefício à escolha e tarifa de membro.

- App PHP inicial (repositório da organização no GitHub): não está em uso; tem falhas graves e não deve ir ao ar como está. Plano para trazer as ideias úteis dele (`docs/analise-app-php-inicial.md`, perguntas 53 a 57).

## Pendente do hotel
Todas as decisões que dependem do hotel estão em `docs/perguntas-em-aberto.md`.
