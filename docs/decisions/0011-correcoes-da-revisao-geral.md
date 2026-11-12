# 0011. Correções da revisão geral

- Status: Aceita (item 8 substituído e item 4 completado pelo ADR 0012)
- Data: 2026-11-12

## Contexto
Uma revisão do projeto inteiro (regras, segurança e LGPD, banco, documentação) encontrou brechas que nenhuma auditoria por módulo tinha pegado. Aqui ficam as correções técnicas que não dependiam do hotel. O que depende do hotel foi para `docs/perguntas-em-aberto.md`.

## Decisões
1. **"Hoje" é o dia em São Paulo.** `timeZone: 'America/Sao_Paulo'` em `src/config/loyalty.ts`. As datas de entrada e saída já são do calendário do hotel; o instante atual é convertido para esse fuso (`localDate` em `src/domain/time.ts`).
   - O check-out só credita pontos se a data de saída for hoje ou antes, no fuso do hotel. Antes, a comparação em UTC com 1 dia de folga deixava creditar até ~2 dias antes da saída.
   - O aviso de vencimento mostra o dia do vencimento no fuso do hotel.
2. **Estadias anteriores ao cadastro não pontuam** (como já dizia o ADR 0004, mas o código não checava). É recusada (422 `stay_out_of_period`) a estadia cuja saída é anterior ao dia do cadastro. Quem se cadastra durante a estadia, até no dia da saída, pontua por ela.
3. **Lançamento manual tem prazo:** só estadias com saída nos últimos 30 dias (`manualStayMaxDaysBack`). Padrão adotado; o hotel pode mudar (pergunta em aberto).
4. **Estadia repetida:** sem número da reserva (`externalRef`), uma estadia cujo período se sobrepõe a outra do mesmo hóspede é recusada (409). Com números diferentes, períodos sobrepostos são aceitos (hóspede com dois quartos). O hóspede é travado ao lançar: clique duplo não cria duas.
5. **Datas dos lançamentos vêm do relógio da aplicação**, não do banco (`createdAt` dos pontos, `memberSince` do hóspede, `requestedAt` do resgate). Antes, a janela de 12 meses do nível no PostgreSQL usava a hora real e divergia dos testes; um teste de integração ia quebrar sozinho em 20/12/2026.
6. **Nível decidido sob a trava do hóspede** no check-out, com os pontos-base relidos dentro da transação (`decideTier`). Dois check-outs simultâneos que juntos atingem o nível agora sobem o hóspede.
7. **Hóspede anonimizado** (quando a anonimização existir) não ganha pontos no check-out, não recebe estadia nova, e quem indicou só recebe o bônus se estiver ativo.
8. **Proxy:** `TRUST_PROXY=true` foi substituído por `TRUST_PROXY_HOPS` (número de proxies seus na frente). Confiar em todos deixava o cliente inventar o IP e furar o limite de tentativas. O servidor recusa iniciar se encontrar a variável antiga.
9. **Cadastro não revela se o código de indicação existe:** a resposta não traz mais `pendingWelcomePoints`.
10. **Rotina noturna** só carrega os lotes que vencem até hoje + 90 dias, com índice em `expiresAt`. Novos índices: `Guest.tierValidUntil`, `Guest.referredById`, `AuditLog(entity, entityId, at)` (migração `20261112000002_indices`).
11. Documentação, simulador da página comercial (nível só por pontos-base) e perguntas em aberto atualizados.

## Consequências
- 130 testes rápidos e 24 de integração passando.
- Ainda dependem do hotel: limites de valor e aprovação de gerente para estadia manual; confirmar o dono do CPF/e-mail no cadastro (hoje o cadastro ainda responde "já existe cadastro"); aniversário, campanhas, avisos e estorno anunciados mas não implementados; regras de exclusão LGPD. Ver `docs/perguntas-em-aberto.md`.
