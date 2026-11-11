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
- Sem proteção de limite de requisições por IP (só a trava por conta). A trava por conta permite que alguém bloqueie a conta de outra pessoa de propósito por 15 minutos. Definir limite por IP quando houver proxy/HTTPS.
- Sem segundo fator (2FA) e sem recuperação de senha por e-mail: só o administrador redefine.
- É obrigatório usar HTTPS em produção (o token e a senha trafegam em texto na rede sem ele).
- A auditoria é gravada depois da operação, não na mesma transação: uma queda entre as duas pode deixar uma operação sem registro. Mover para a mesma transação se isso for exigência de conformidade.
- O sistema do hóspede (site/app) ainda não existe e precisará de login próprio. A integração com o Erbon precisará de um acesso de serviço (decidir no ADR do Erbon).
- Os registros de auditoria não têm prazo de retenção definido (LGPD): definir por quanto tempo guardar.
- Não testado contra PostgreSQL real.
