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
