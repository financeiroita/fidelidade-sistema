# 0010 — Login de funcionários, permissões e registro de auditoria

- **Status**: Aceita (mecanismo); os papéis e permissões são valores iniciais para o hotel ajustar
- **Data**: 2026-11-11

## Decisão
- **Acaba a chave única compartilhada.** Cada funcionário tem usuário e senha (`POST /auth/login`) e recebe um token de sessão enviado em `Authorization: Bearer <token>`. Rotas públicas: `/health`, `POST /guests`, `GET /rewards`, `POST /auth/login`.
- **Senha**: política de 12 a 128 caracteres, com variedade, sem conter o usuário. Guardada só como hash scrypt com sal (32 MB por tentativa). Nunca em claro, nunca em log.
- **Sessão**: token aleatório de 256 bits; no banco fica só o hash (quem vazar o banco não consegue usar a sessão). Dura 12 horas. Logout, desativação, troca e redefinição de senha encerram sessões.
- **Proteção contra adivinhação**: 5 senhas erradas seguidas travam a conta por 15 minutos (a contagem é um único UPDATE, sem perder tentativas simultâneas). Usuário inexistente, senha errada, conta travada e conta desativada dão a mesma resposta (401), gastando o mesmo tempo.
- **Papéis** (o mais alto herda o dos mais baixos):
  - `RECEPTION`: lançar estadia, fazer check-out, resgatar, confirmar e usar resgate, ver saldo e extrato.
  - `MANAGER`: tudo isso e mais **cancelar resgate** (devolve pontos), cadastrar e alterar prêmios, consultar a auditoria.
  - `ADMIN`: tudo isso e mais criar, ativar, desativar funcionários e redefinir senhas. Não pode desativar a si mesmo.
- **Auditoria** (`AuditLog`, `GET /audit` para gerente e administrador): registra quem fez o quê e quando em estadia, check-out, resgate, confirmação, uso, cancelamento, prêmio, funcionários, login (ok e falho) e **tentativas negadas por falta de permissão**. Só ids, pontos e contagens; **nunca** dados pessoais do hóspede, nem o usuário digitado num login falho (poderia ser uma senha digitada no campo errado).
- Se a gravação da auditoria falhar, a operação já concluída **não é desfeita**; o erro (só o código) vai para o log técnico.
- **Primeiro administrador**: `npm run operator:create -- --username maria --name "Maria Souza" --role ADMIN`. A senha é pedida no terminal, sem aparecer na tela nem no histórico. O servidor não sobe se não houver um administrador ativo.

## Limitações e pendências
- (Atualizado) O limite por IP foi implementado na auditoria (ver abaixo). A trava por conta ainda permite bloquear de propósito a conta de outra pessoa por 15 minutos.
- Sem segundo fator (2FA) e sem recuperação de senha por e-mail: só o administrador redefine.
- É obrigatório usar HTTPS em produção (o token e a senha trafegam em texto na rede sem ele).
- A auditoria é gravada depois da operação, não na mesma transação: uma queda entre as duas pode deixar uma operação sem registro. Mover para a mesma transação se isso for exigência de conformidade.
- O sistema do hóspede (site/app) ainda não existe e precisará de login próprio. A integração com o Erbon precisará de um acesso de serviço (decidir no ADR do Erbon).
- Os registros de auditoria não têm prazo de retenção definido (LGPD): definir por quanto tempo guardar.
- Testado em PostgreSQL 18 embutido (`npm run test:integration`); falta validar no 16 do docker-compose.

## Auditoria de 2026-11-11
Corrigido:
- **Rajada de logins** (alto): no máximo 4 senhas são processadas ao mesmo tempo, com fila de 64; o que passa disso recebe 503. Depois da senha, a conta é relida (travada ou desativada no meio da rajada é recusada). **Limite por IP** (`@fastify/rate-limit`): login e troca de senha 10 por minuto, cadastro público 20 por minuto (429). Corpo de 1 KB nas rotas de senha, timeout de conexão e de requisição de 30 s. ~~Use `TRUST_PROXY=true`~~ (substituído no ADR 0011 por `TRUST_PROXY_HOPS`, o número de proxies seus na frente). Depois substituído por `TRUST_PROXY_ADDRS`, com os endereços dos proxies (ADR 0012).
- **Auditoria inchada:** login de usuário desconhecido não é mais gravado (qualquer pessoa na internet encheria o histórico).
- **Trocar a própria senha** agora conta as senhas atuais erradas e trava (quem roubou uma sessão não adivinha por aqui).
- **Administradores:** ninguém redefine a própria senha pela rota de administrador (só pela rota própria, com a senha atual); o último administrador ativo não pode ser desativado, nem por dois pedidos simultâneos (trava as linhas dos administradores); `npm run operator:unlock -- --username x` reativa e destrava uma conta pela linha de comando.
- **Senha:** a política mede depois da normalização (caracteres reais), recusa uma lista curta de senhas muito comuns e detecta o usuário em largura total. Uma lista grande de senhas vazadas ainda seria melhor.
- **Auditoria de leitura (LGPD):** consultar saldo e extrato de um hóspede e consultar a própria auditoria agora ficam registrados; a criação de estadia guarda o hóspede e o total.
- **Falha ao gravar auditoria no login** agora vai para o log técnico (só o código).
- Respostas com `Cache-Control: no-store` e `X-Content-Type-Options: nosniff`; consulta de auditoria validada (filtros repetidos não geram erro 500); sessões vencidas apagadas pela rotina noturna; contagem de falhas sem SQL cru (incremento atômico do Prisma); hash fictício calculado na partida; script de criação de funcionário sem texto de erro do banco, tratando terminal sem interação, setas e Ctrl+C.

Decisões em aberto:
1. **Separação de funções:** a recepção pode lançar uma estadia com valores livres e fazer o check-out, o que credita pontos. Opção: exigir gerente para estadia lançada manualmente, ou dupla conferência. A auditoria já guarda quem, qual hóspede e o total.
2. **Administrador redefine senha de outro administrador:** continua permitido (fica registrado e derruba as sessões do outro). Alternativa: só pela linha de comando.
3. **Segundo fator (2FA)** para gerente e administrador.
4. **Retenção** dos registros de auditoria (LGPD).
5. **Auditoria na mesma transação** da operação, se a conformidade exigir.
6. ~~Testes com PostgreSQL real (trava dos administradores, incremento de falhas, limites).~~ Feito: testado em PostgreSQL 18 embutido (`npm run test:integration`); falta validar no 16 do docker-compose.
