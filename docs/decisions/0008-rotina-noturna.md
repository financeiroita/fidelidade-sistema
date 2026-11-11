# 0008 — Rotina noturna: vencimento de pontos, nível e avisos

- **Status**: Aceita
- **Data**: 2026-11-11

## Decisão
Um script diário (`npm run job:nightly`, `src/jobs/nightly.ts`) faz três coisas, cada uma segura para repetir:
1. **Vencimento de pontos.** Cada lote vencido com saldo é zerado e gera um lançamento `EXPIRE` negativo (chave única `expire:<lote>`). O lote só expira se o saldo ainda for o que foi lido, para não brigar com um resgate concorrente.
2. **Avisos de vencimento.** Um aviso por hóspede, na menor janela aplicável (90 ou 30 dias), gravado na tabela `ExpiryNotice` com chave única (hóspede, janela, data do primeiro vencimento). A rotina só **grava** o aviso; o envio por e-mail ou WhatsApp é outra etapa e ainda não existe.
3. **Revisão de nível.** Só para quem tem nível acima do inicial e validade vencida. Recalcula pelos pontos-base dos últimos 12 meses: desce, mantém ou sobe, e ganha nova validade de 12 meses (Bronze não tem validade). Usa a mesma trava do hóspede do check-out.
- Falha em um hóspede não interrompe os demais; o script termina com código 2 se houve erros, para o agendador alertar.

## Como agendar
Uma vez por dia, de madrugada. No Linux, cron; no Windows, Agendador de Tarefas rodando `npm run job:nightly` na pasta do projeto, com o `.env` preenchido.

## Limitações
- Carrega todos os lotes com saldo em memória a cada rodada. Aceitável para um hotel; trocar por leitura em lotes se crescer muito.
- O resgate de pontos (que consome lotes) ainda não existe; quando existir, deve gravar o consumo no campo `remaining`.
- Envio dos avisos e cumprimento de consentimento (LGPD): decidir se o aviso de vencimento é mensagem de serviço (vale para todos) ou só para quem aceitou marketing.
- Bônus de aniversário (500 pontos) ainda não implementado.
- Não testado contra PostgreSQL real.

## Auditoria de 2026-11-11
Corrigido:
- **Ordem de travas:** `expireLot` agora trava o hóspede antes dos lotes, como o check-out e a revisão de nível. Regra para todo fluxo futuro (em especial o resgate): **primeiro o hóspede, depois os lotes**, para não gerar impasse (deadlock).
- **Revisão de nível sem leitura velha:** os pontos-base são somados dentro da transação, depois da trava do hóspede; um check-out simultâneo já aparece no cálculo.
- **Nível vencido no check-out:** se a validade do nível acabou e a rotina ainda não rodou (ou falhou), o check-out não dá o multiplicador do nível vencido; vale o que o hóspede atinge pelos pontos-base dos últimos 12 meses.
- **Robustez:** cada etapa é isolada (falha ao carregar lotes não impede a revisão de nível); erros são registrados com etapa, id (UUID) e código, sem mensagens do banco nem dados pessoais; o `$disconnect` do script não pode mais gerar erro solto.
- **LGPD:** hóspede anonimizado não recebe aviso de vencimento (os pontos dele vencem normalmente) e não entra na revisão de nível.
- **Datas:** uma única função `addMonths` (`src/domain/time.ts`) que não estoura o fim do mês (31/01 + 1 mês = 28/02).

Regras para o resgate (a implementar):
1. Saldo disponível = lotes com `remaining > 0` e `expiresAt > agora` (usar `consumeFifo`), **nunca** a soma simples de `points`, que ainda inclui pontos vencidos até a rotina rodar.
2. Estorno (`REVERSAL`) de crédito cujo lote já expirou: regra a definir, para não deixar saldo negativo.
3. Lotes sem `expiresAt` nunca vencem; todo crédito, inclusive ajuste manual, deve ter validade.

Observações: o aviso já gravado mantém o total antigo se outro lote entrar na janela com o mesmo primeiro vencimento. Antes do primeiro uso em produção, conferir hóspedes com nível acima do Bronze e validade nula (ex.: dados de teste), pois serão revisados e podem ser rebaixados na primeira rodada.
