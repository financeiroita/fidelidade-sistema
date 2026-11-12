# 0016. Correções da segunda revisão geral

- Status: Aceita
- Data: 2026-11-12
- Substitui: item 5 do ADR 0014 (prêmios com nível vencido); parte do item 7 do ADR 0014 (modo de teste); completa o ADR 0003 (vencimento) e o ADR 0012 (proxy e número da reserva)

## Contexto
Um auditor e um verificador revisaram o projeto inteiro depois da área do hóspede. Nenhuma falha grave. Aqui ficam as correções que não dependiam do hotel. O que depende do hotel foi para `docs/perguntas-em-aberto.md` (perguntas 49 a 52).

## Decisões
1. **Os pontos valem até o fim do dia do hotel.**
   - Antes, um ponto creditado às 11h de 12/11/2026 vencia às 11h de 12/11/2028. A página dizia "vencem em 12/11", e às 15h desse dia o resgate já era recusado.
   - Agora o vencimento é o início do dia seguinte, no fuso do hotel (`expirationDate` em `src/domain/points/expiry.ts`).
   - A "Minha conta" e o aviso de vencimento mostram o **último dia para usar** ("Use até 12/11/2028"), calculado por `lastValidDay`.
   - Lotes já gravados com a regra antiga continuam vencendo na hora antiga. Ainda não há banco de produção.
2. **Número da reserva sempre em maiúsculas.** `res-123` e `RES-123` são o mesmo lançamento. Antes, as duas eram aceitas e pontuavam em dobro.
3. **Uma regra só para nível vencido** (substitui o item 5 do ADR 0014):
   - Se a validade do nível acabou e a rotina noturna ainda não revisou, vale o que os pontos-base da janela garantem (`effectiveTierRank` em `src/domain/tiers/tier.ts`).
   - Check-out, resgate e "Minha conta" usam essa mesma função. Antes, o resgate tratava o hóspede como Bronze, e ele perdia os prêmios restritos se a rotina noturna falhasse.
   - No resgate, os pontos-base são lidos sob a trava do hóspede.
   - A resposta do check-out, quando o nível continua vencido, mostra o nível que os pontos garantem já contando a estadia.
4. **O `.env` é carregado pelo próprio sistema** (`src/env.ts`, importado primeiro pelo servidor, pelos comandos e pela carga inicial). Antes dependia de um efeito colateral do Prisma, que falha se o `.env` for criado depois do `npm install`. Variáveis já definidas no sistema têm prioridade.
5. **Proxy:** faixas mais largas que `/8` (IPv4) ou `/32` (IPv6) são recusadas. Antes só `/0` era recusado, e duas faixas `/1` equivaliam a "confiar em todos".
6. **Modo de teste do código do hóspede** (substitui parte do item 7 do ADR 0014): `GUEST_CODE_DELIVERY=console` agora exige `NODE_ENV=development` declarado **e** o banco nesta máquina. Um servidor único que não declarasse nada passava.
7. **Hóspede bloqueado por erros de código não recebe códigos novos** até o bloqueio acabar. Cada código errado de um hóspede existente gera um registro no log, só com o id.
8. **Bônus de indicação:** quem indicou só recebe se ainda estiver ativo no momento da gravação, conferido dentro da transação.
9. **Banco:** nova migração `20261112000004_mais_restricoes`, com travas de integridade:
   - pontos-base nunca negativos, e lote com saldo sempre tem validade;
   - prêmio com custo positivo;
   - datas e noites da estadia coerentes;
   - aviso de vencimento com pontos positivos;
   - tentativas de login nunca negativas;
   - sessão de hóspede que vence depois de criada.
10. **Extrato** com desempate pelo id, para a ordem não variar entre linhas da mesma data.
11. As validações de partida do servidor foram para `src/config/startup.ts`, sem efeitos colaterais, e ganharam testes.

## Pendente
- `Redemption.stayId` continua sem chave estrangeira.
- `PointsTransaction.createdBy` não é preenchido; o vínculo com o funcionário está só na auditoria (pergunta 27).
- Limite por IP com IPv6 (agrupar por `/64`) e tratamento do tempo limite de transação como 503.
- As páginas de rascunho em `docs/comunicacao/` ainda carregam fontes do Google; resolver antes de publicar.
