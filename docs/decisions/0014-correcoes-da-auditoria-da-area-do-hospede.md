# 0014. Correções da auditoria da área do hóspede

- Status: Aceita (item 5 e parte do item 7 substituídos pelo ADR 0016)
- Data: 2026-11-12
- Substitui: partes dos itens 1, 2, 4 e 7 do ADR 0013 (indicadas abaixo)
- Nota (2026-11-12): as fontes do Google estavam no item 6 do ADR 0013, não no item 1; leia "itens 2, 4, 6 e 7".

## Contexto
O auditor revisou o commit da "Minha conta" (ADR 0013). Não achou falha de gravidade alta. Os problemas de gravidade média foram estes:
- força bruta lenta (cerca de 1.440 palpites por dia por conta);
- qualquer pessoa conseguia impedir o hóspede de entrar, porque cada pedido novo invalidava o código que ele tinha recebido;
- a página dizia "disponível" para prêmios que a recepção recusava;
- o tempo de resposta revelava se o e-mail estava cadastrado.

## Decisões
1. **Limites do código (substitui parte do item 2 do ADR 0013):**
   - continuam valendo 3 códigos a cada 15 minutos por hóspede;
   - passa a haver um teto de **10 códigos por dia**;
   - os **10 erros em 24 h**, somando todos os códigos, **bloqueiam o acesso pela internet** até completar as 24 h;
   - a chance de adivinhar fica perto de 1 em 30 mil por conta por dia.
   - **Troca aceita:** quem sabe o e-mail de um hóspede pode bloquear o acesso dele pela internet por um dia. Ele continua sendo atendido na recepção. Preferimos isso a deixar a conta vulnerável à adivinhação.
2. **Pedir de novo não invalida o código anterior** (substitui "só o código mais novo vale"):
   - todo código ainda dentro dos 10 minutos vale;
   - ao entrar com um deles, os outros são queimados;
   - assim, um terceiro pedindo códigos não impede o hóspede de usar o que recebeu, porque os pedidos de terceiros também chegam ao e-mail do próprio hóspede.
3. **O pedido de código responde antes de consultar o banco.** Consulta, gravação e envio rodam em segundo plano, então a resposta tem o mesmo tempo exista ou não o e-mail. Na verificação, um e-mail desconhecido percorre o mesmo caminho no banco, com um id que não existe.
4. **O código é guardado como HMAC com o segredo do servidor** (`DOCUMENT_HASH_SECRET`, com rótulo próprio), não como um SHA-256 simples. Quem lê só o banco não consegue descobrir o código.
5. **Os prêmios seguem a regra do resgate:** se o nível venceu e a rotina noturna ainda não rodou, a página não abre prêmios restritos, igual à recepção. O resumo do nível continua mostrando o que os pontos garantem (ADR 0013, item 4).
6. **A página não chama nenhum servidor de terceiros** (substitui o uso das fontes do Google no item 1 do ADR 0013):
   - ela usa as fontes do próprio aparelho, e a política de segurança (CSP) só aceita o próprio servidor;
   - antes, cada visita mandava o IP do hóspede ao Google.
7. **O modo de teste `GUEST_CODE_DELIVERY=console`** (substitui parte do item 7 do ADR 0013): o servidor também o recusa quando o banco não está nesta máquina, além de recusar com `NODE_ENV=production`.
8. A pasta `web/` é achada a partir do código, e não da pasta de onde o servidor foi iniciado. Se os arquivos faltarem, a API sobe mesmo assim, só sem a página.
9. `/me/rewards` não devolve mais o id do prêmio, e a limpeza noturna em memória ficou igual à do banco.

## Observação
O cadastro público (`POST /guests`) ainda responde "já existe cadastro" para um e-mail ou CPF repetido. Então, por esse caminho, ainda dá para descobrir quem é hóspede. A "Minha conta" não revela isso, mas o sistema como um todo só deixa de revelar quando a confirmação de e-mail no cadastro existir (pergunta 18).
