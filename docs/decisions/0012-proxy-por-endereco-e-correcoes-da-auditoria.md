# 0012. Proxy por endereço e correções da auditoria do ADR 0011

- Status: Aceita
- Data: 2026-11-12
- Substitui: item 8 do ADR 0011 (`TRUST_PROXY_HOPS`); completa o item 4 do ADR 0011

## Contexto
Um auditor revisou o commit do ADR 0011 e encontrou dois problemas de gravidade média e alguns de gravidade baixa.

## Decisões
1. **Proxy por endereço, não por contagem:** `TRUST_PROXY_HOPS` foi substituído por `TRUST_PROXY_ADDRS`, que lista os endereços ou faixas dos proxies do hotel (ex.: `127.0.0.1` ou `10.0.0.0/8`).
   - O IP informado no `X-Forwarded-For` só é aceito quando o pedido vem de um desses endereços.
   - Com a contagem de saltos, quem conseguisse conectar direto na porta da API (firewall mal configurado, rede interna) podia inventar o próprio IP e furar o limite de tentativas. O próprio Fastify passou a recusar contagem de saltos por esse motivo.
   - O servidor não inicia se encontrar `TRUST_PROXY` ou `TRUST_PROXY_HOPS`, se um endereço for inválido ou se uma faixa for `/0` ("todos").
2. **Estadia repetida independe da ordem dos lançamentos:** período sobreposto a outra estadia do mesmo hóspede é recusado (409), a não ser que **as duas** tenham número da reserva.
   - Antes, lançar primeiro sem número e depois com número criava duas estadias (pontos em dobro). Na ordem inversa, a segunda era recusada.
   - Número da reserva repetido continua recusado, mesmo para outro hóspede.
3. **Hóspede excluído no meio do check-out:** a trava do hóspede no crédito filtra os excluídos. Se ele foi anonimizado entre a leitura e a gravação, nada é creditado (409 `stay_not_eligible`).
4. **Nível na resposta do check-out** vem do que ficou gravado. Antes, quem renovava um nível com validade vencida via o nível de baixo na resposta, embora o banco tivesse o nível renovado.
5. Os repositórios em memória (usados nos testes rápidos) agora imitam a exclusão de hóspede (`deletedAt`), como o banco.

## Pendente
- **Day use:** a regra de sobreposição só se aplica quando entrarem estadias do PMS, porque hoje o lançamento manual exige saída depois da entrada. Ela é assimétrica: o day use no dia de entrada de outra estadia é recusado, e no dia de saída é aceito. Isso deve ser decidido na integração com o Erbon.
- **Avisos já gravados:** se já existirem avisos de vencimento gravados com a data antiga em UTC (homologação, por exemplo), a primeira rotina com o fuso do hotel pode repetir um aviso. Ainda não há banco de produção.
