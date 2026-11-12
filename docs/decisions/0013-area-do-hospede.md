# 0013. Área do hóspede ("Minha conta") com código por e-mail

- Status: Aceita (o provedor de e-mail ainda depende do hotel). Os limites do código, a validade dos códigos anteriores, as fontes e o modo de teste foram ajustados pelo ADR 0014.
- Data: 2026-11-12

## Contexto
Até aqui, só a recepção via o saldo e o extrato do hóspede. O hóspede não tinha como acompanhar os próprios pontos, o nível, os vencimentos e os prêmios.

## Decisões
1. **Página "Minha conta"** em `/minha-conta`, servida pela própria API. Os arquivos ficam em `web/`. A página é pensada para o celular primeiro, segue a identidade da página do programa e não usa bibliotecas de terceiros.
2. **Entrada sem senha, com código de 6 dígitos enviado ao e-mail do cadastro:**
   - O código vale 10 minutos e uma única vez. Só o código mais novo vale.
   - Cada código aceita no máximo 5 tentativas; depois é queimado.
   - São no máximo 3 códigos por hóspede a cada 15 minutos, mais o limite por IP (10 por minuto).
   - No banco fica só o hash do código e do token da sessão.
   - Pedir o código responde sempre `202`, exista ou não o e-mail. A página não revela quem é hóspede.
3. **Sessão do hóspede** é separada da sessão de funcionário:
   - Ela dura 24 horas, e o navegador guarda o token só na aba aberta (`sessionStorage`).
   - Um token de hóspede não abre rotas internas, e um token de funcionário não abre `/me`.
   - O id do hóspede vem da sessão, nunca da URL, então ninguém consulta os dados de outro hóspede.
   - Hóspede excluído (LGPD) perde a sessão e não recebe código.
4. **O que o hóspede vê:**
   - nome (só o primeiro), nível e validade, pontos disponíveis e de boas-vindas pendentes;
   - progresso para o próximo nível (pontos-base dos últimos 12 meses);
   - os 3 próximos vencimentos (por dia do hotel);
   - o extrato e o código de indicação;
   - os prêmios, com "disponível", "faltam X pontos" ou "a partir do nível Y".
   - Não aparecem o CPF, o e-mail, o telefone nem ids internos. Nível vencido (a rotina noturna ainda não rodou) aparece pelo que os pontos garantem, igual ao check-out.
5. **O resgate continua na recepção.** A página só mostra o que já dá para resgatar.
6. **Segurança da página:**
   - Uma política de conteúdo (CSP) restrita: só o próprio script e as fontes do Google.
   - A página não pode ser embutida em outros sites, nem é indexada.
   - Os dados da API entram como texto, nunca como HTML.
7. **Envio do código:** o provedor de e-mail ainda não foi escolhido. Até lá:
   - com `GUEST_CODE_DELIVERY=console`, o código aparece no terminal (só para testes; o servidor recusa esse modo em produção);
   - sem a variável, o login do hóspede responde `503`, e a página avisa para consultar a recepção.
8. A rotina noturna apaga as sessões de hóspede vencidas e os códigos vencidos há mais de 1 dia.
9. `npm run demo:minha-conta` sobe uma demonstração só em memória, com uma hóspede de exemplo, na porta 3100.

## Consequências
- Tabelas novas: `GuestLoginCode` e `GuestSession`, na migração `20261112000003_area_do_hospede`.
- Rotas novas, todas públicas ou com a sessão do hóspede:
  - `POST /me/login/request`, `POST /me/login/verify`;
  - `GET /me`, `GET /me/statement`, `GET /me/rewards`;
  - `POST /me/logout`;
  - `GET /minha-conta` e os arquivos da página.
- Perguntas em aberto 29 a 32 em `docs/perguntas-em-aberto.md`: o provedor de e-mail, o código por WhatsApp, o resgate pela internet e o tempo de sessão.
- O código por e-mail também é o caminho natural para confirmar o dono do e-mail no cadastro (pergunta 18).
