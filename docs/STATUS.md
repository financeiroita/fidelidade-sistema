# Status do projeto

_Atualizado: 2026-11-12_

## Feito
- Cadastro de hóspede com CPF obrigatório e protegido (HMAC, só os 4 últimos dígitos à vista) (ADRs 0005 e 0006).
- Crédito de pontos no check-out e lançamento manual de estadias pela recepção (ADR 0007).
- Rotina noturna: vencimento de pontos, revisão de nível e gravação dos avisos de vencimento (ADR 0008).
- Resgate de pontos, catálogo de prêmios, saldo e extrato (ADR 0009).
- Login por funcionário, papéis (recepção, gerente, administrador) e registro de auditoria (ADR 0010).
- Área do hóspede "Minha conta" (`/minha-conta`): entrada por código no e-mail, saldo, nível, progresso, vencimentos, extrato e prêmios (ADR 0013). Demonstração sem banco: `npm run demo:minha-conta`.
- Testes: 153 rápidos (`npm test`, sem banco) e 30 de integração com PostgreSQL de verdade (`npm run test:integration`, versão 18 embutida, sem Docker).
- Correções da revisão geral de 2026-11-12 e da auditoria seguinte (ver ADRs 0011 e 0012).

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
- Publicar no GitHub (`gh auth login`).

## Pendente do hotel
Todas as decisões que dependem do hotel estão em `docs/perguntas-em-aberto.md`.
