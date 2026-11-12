# 0015. Instagram no programa: pontos por marcação do hotel

- Status: **Proposta** (aguarda as decisões do hotel, perguntas 34 a 40; nada implementado)
- Data: 2026-11-12

## Contexto
O hotel quer que as interações no Instagram (seguir, curtir, comentar) rendam pontos. Antes de decidir, é preciso saber o que o Instagram deixa conferir e o que as regras da Meta permitem.
- **Atenção:** este levantamento usa o conhecimento disponível em 2026-11-12, sem consulta à documentação atual da Meta.
- As regras e a API mudam com frequência. Confirme antes de implementar.

## O que o Instagram permite conferir (API para contas profissionais)
| Interação | O sistema sabe quem fez? | Conclusão |
|---|---|---|
| Seguir o perfil do hotel | Não: só o número de seguidores | Não dá para pontuar |
| Curtir uma postagem | Não: só o número de curtidas | Não dá para pontuar |
| Comentar postagem do hotel | Sim: o comentário vem com a conta de quem escreveu | Possível, não recomendado |
| Marcar o @ do hotel em post, reels ou story | Sim: o Instagram avisa na hora | **Recomendado** |
| Mensagem direta ao hotel | Sim | Usada para provar que o @ é do hóspede |

Além do limite técnico, dar pontos em troca de seguir ou curtir esbarra nas regras da Meta, que tratam isso como engajamento artificial. O perfil do hotel corre o risco de perder alcance ou ser punido.

Comentários pontuados viram spam, e o Instagram reduz o alcance de quem força engajamento. Comentário fica só para sorteios eventuais com regulamento próprio, ligados às campanhas (pergunta 5).

## Desenho proposto
1. **Vincular a conta:**
   - Na "Minha conta" (ADR 0013), o hóspede informa o @ dele e recebe um código de 6 dígitos.
   - Ele envia esse código por mensagem direta ao Instagram do hotel. O sistema recebe a mensagem e confirma que o @ é dele.
   - O sistema guarda o identificador da conta no Instagram, e não só o @, porque o @ pode mudar.
   - Um @ só pode estar ligado a um hóspede, e desvincular é possível a qualquer momento.
2. **Pontuar a marcação** (post, reels ou story com o @ do hotel):
   - Vale só para quem tem estadia recente: check-out nos últimos N dias (pergunta 36).
   - Tem um teto de marcações pontuadas por estadia ou por mês (pergunta 35).
   - **O marketing aprova antes de creditar.** Há uma fila simples para barrar marcação falsa, foto que não é do hotel ou conteúdo impróprio. Story some em 24 h, então a fila guarda uma cópia da imagem até a aprovação e a apaga depois.
   - São pontos de **bônus**: entram no saldo e vencem normalmente, mas **não contam para o nível** (ADR 0003). O lançamento usa o tipo `EARN_BONUS`, com chave de idempotência pela publicação, para a mesma publicação nunca pontuar duas vezes.
   - Funcionário que aprova fica registrado na auditoria (ADR 0010).
3. **LGPD:**
   - Ligar o Instagram ao cadastro exige uma autorização própria, separada do aceite do regulamento e do consentimento de marketing.
   - O hóspede vê na "Minha conta" que a conta está ligada e pode desligar.
   - Na exclusão de dados, o vínculo e as cópias das publicações são apagados.
4. **Seguir e curtir não pontuam.** Os textos para o hóspede não devem prometer isso.

## O que o hotel precisa providenciar
- O Instagram do hotel como **conta profissional**, ligada a uma **página do Facebook**.
- Um **aplicativo cadastrado na Meta**, com a empresa verificada e as permissões aprovadas pela Meta: menções, comentários e mensagens. A Meta revisa o pedido, e isso costuma levar semanas.
- Atualizar o regulamento com a regra dos pontos por marcação.

## Consequências (se aprovado)
- O banco ganha:
  - o vínculo hóspede–Instagram;
  - a fila de marcações a aprovar;
  - a autorização LGPD separada.
- A API ganha:
  - o endereço que recebe os avisos do Instagram, com conferência da assinatura da Meta;
  - as rotas de vínculo e desvínculo na "Minha conta";
  - as rotas de aprovação para o marketing, com um papel de acesso a definir.
- O segredo do aplicativo da Meta fica no `.env`, nunca no código.
