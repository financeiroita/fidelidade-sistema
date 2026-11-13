# Análise do app PHP inicial (fidelidade-itamambuca)

_Feita em 2026-11-13 sobre o repositório público https://github.com/Itamambuca-Eco-Resort/fidelidade-itamambuca (1 commit, `eea4f87`). Lido sem executar nada. Os caminhos citados são desse repositório._

## Resumo
- O app PHP é um **app de engajamento dentro do resort**. Ele faz:
  - check-in por QR nas atividades;
  - missões, selos e ranking;
  - programação da recreação;
  - informações úteis;
  - painel das atividades.
- Ele **não** faz fidelidade por gasto: não há pontos por R$, estadia, Erbon, CPF nem auditoria de funcionários.
- O nosso sistema (TypeScript) é o **núcleo de pontos**: folio no check-out, níveis em 12 meses, resgate pela recepção, auditoria e a "Minha conta". Os dois se complementam mais do que se sobrepõem.
- **O app PHP tem falhas graves de segurança.** Se estiver no ar, qualquer pessoa consegue virar administrador ou ganhar pontos ilimitados (ver "Urgente"). Não há senhas nem chaves no repositório.
- O código está incompleto e tem erros:
  - falta a página inicial (`index.php`);
  - as páginas de missões e de busca quebram;
  - há tabelas usadas que nunca são criadas;
  - existem três tabelas de níveis diferentes;
  - há sobras de outros projetos: "Santour Guide" e "Agenda do SPA";
  - não há testes.
- **Recomendação:** não reaproveitar o código PHP. Trazer para o nosso sistema, aos poucos, as **ideias** boas dele (check-in por QR de uso único, recreação, informações, catálogo de atividades) e desligar o app PHP.

## Urgente (se o app PHP estiver no ar)
Confirmado no código.

| # | Problema | Onde | O que fazer já |
|---|---|---|---|
| U1 | **Login pelo Google sem conferir o token**: dá para entrar com o e-mail de qualquer pessoa, inclusive admin | `auth/google-callback.php:15-31` | Desligar o botão do Google até validar o token com as chaves do Google |
| U2 | **Hóspede vira admin** ao cadastrar um "serviço" | `dashboard/adicionar-servico.php:65-69` | Apagar a promoção automática e exigir admin na página |
| U3 | **Cadastro público aceita "parceiro"** | `auth/register.php:15,35` | Apagar o arquivo (legado do Santour) |
| U4 | **Pontos do check-in vêm do cliente**: o campo `photo_url` vira a quantidade de pontos | `api/checkin.php:40-53` + `models/Gamification.php:536` | Apagar o endpoint |
| U5 | **Script aberto que dá 10.000 pontos** e apaga as travas (triggers) do banco | `auth/add-points.php` | Apagar do servidor; conferir se as triggers de `user_points` ainda existem |
| U6 | **Compartilhar dá +10 pontos sem limite** | `api/share.php:50-58` | Apagar o endpoint |
| U7 | **QR fixo das atividades vale para sempre**: uma foto do QR pontua de casa todo dia | `api/scan-qr.php`, `dashboard/qrcodes.php` | Pontuar só pelo QR de 5 minutos gerado pela equipe |
| U8 | **Scripts de manutenção abertos na web**, alguns destrutivos (`DELETE FROM partners`, `DROP COLUMN`); o `.htaccess` da raiz está inativo | `scripts/manutencao/*.php`, `htaccess` | Tirar `scripts/` e `database/` da pasta pública; ativar um `.htaccess` revisado |

**Depois de fechar essas falhas:**
- Conferir no banco se houve abuso:
  - usuários `admin` ou `partner` que não deveriam ter esse papel;
  - lançamentos `admin`, `checkin` com valores fora de 50 e 100, ou `share` em massa.
- Trocar a senha do banco.
- Tornar o repositório **privado**. Ele não tem senhas, mas mostra a qualquer um como explorar as falhas.

### Outras falhas (altas e médias)
- **Resgate sem trava.** Dois cliques simultâneos gastam o mesmo saldo duas vezes, e prêmios desativados continuam resgatáveis (`models/Gamification.php:625-662`).
- **Token de check-in sem trava.** Várias leituras simultâneas do mesmo QR pontuam várias vezes (`api/validate-checkin-token.php`).
- **XSS no catálogo de prêmios** (`recompensas.php:62,73`, `servico.php:276`).
- **Parceiro mexe em fotos e cupons de outros parceiros** (`dashboard/fotos.php`, `dashboard/cupons.php`).
- **Sessão e formulários:**
  - o id da sessão não é renovado no login;
  - o cookie não tem `Secure`, `HttpOnly` nem `SameSite`;
  - nenhum formulário tem proteção contra requisição forjada (CSRF);
  - conta desativada continua entrando.
- **Dados pessoais:**
  - o ranking mostra o nome completo dos 100 primeiros;
  - o painel mostra o e-mail dos clientes a parceiros;
  - cada check-in grava a localização;
  - cada visita grava o IP;
  - não há aviso de privacidade, consentimento nem exclusão de conta (LGPD).
- **Erros do PHP aparecem na tela** (`display_errors=1`), e uma falha de conexão mostra o usuário do banco.

## O que o app PHP tem e o nosso não tem
| Funcionalidade do app PHP | Vale trazer? | Como ficaria no nosso sistema |
|---|---|---|
| **Check-in em atividades por QR de 5 minutos** gerado pela equipe | **Sim**, é a melhor ideia do app | Pontos de **bônus** (não contam para o nível, ADR 0003). QR de uso único, consumido de forma atômica. Só vale com estadia ativa. Teto por dia. Registrado na auditoria. |
| QR fixo impresso na atividade | **Não** | Pode ser fotografado e reusado (U7) |
| Pontos por compartilhar e por "seguir no Instagram" | **Não** | Não dá para verificar. O ADR 0015 já decidiu que seguir e curtir não pontuam. |
| Missões e selos (badges) | Talvez, depois | Ideia boa de engajamento. No app PHP está quebrada. Depende do hotel (pergunta 55). |
| Ranking público | **Não**, como está | Expõe nomes. Se o hotel quiser, só com primeiro nome, inicial e opção de sair (pergunta 56). |
| Programação da recreação (7 dias, criança e adulto) | **Sim** | Uma aba na "Minha conta", lendo a mesma base da recreação. |
| Informações úteis e sobre o hotel | **Sim** | Páginas simples na "Minha conta" |
| Catálogo de atividades, busca, favoritos | Talvez | Depende de o app virar também o guia do hóspede (pergunta 53) |
| Painel das atividades (cadastro, fotos, prêmios por atividade) | Parte | O cadastro de prêmios já existe (gerente). Atividades e fotos, se o guia for adiante. |
| Cupons de desconto de parceiros (sem pontos) | Talvez | É outro programa. Hoje são códigos públicos na página. |
| App instalável no celular (PWA) | Sim, simples | Ligar à "Minha conta" com o nome e o ícone do Itamambuca. O do app PHP ainda é do "Santour". |
| Login pelo Google | Talvez | Só com o token validado. Hoje entramos por código no e-mail, que também confirma o e-mail. |

## O que o nosso tem e o app PHP não tem
- Pontos por valor gasto, por categoria do folio, com bônus de reserva direta.
- Níveis por pontos-base em 12 meses com multiplicador. No PHP, o nível cai quando o hóspede gasta pontos.
- CPF protegido, validade por lote com rotina noturna e avisos.
- Resgate com confirmação, uso e cancelamento pela recepção.
- Funcionários com papéis e auditoria.
- Proteção contra corridas.
- 177 testes rápidos e 36 testes no banco real.

## Diferenças de regra que o hotel precisa decidir
- **Boas-vindas:** o PHP dá 100 pontos a todo cadastro; o nosso só dá (500) a quem foi indicado (pergunta 54).
- **Valores dos prêmios:** o PHP cobra drink 1.000, escalda-pés 2.000, 20% na boutique 3.000 e diária 8.000. Com 1 ponto ≈ R$ 0,02, a diária de 8.000 pontos sairia por cerca de R$ 160 em gastos. É preciso alinhar ao valor do ponto (pergunta 4).
- **Nomes dos níveis:** o PHP usa Essencial, Especial, Reserva e Exclusivo VIP (pago); o nosso usa Bronze, Prata, Ouro e Diamante (pergunta 10).
- **CPF:** o PHP não pede; o nosso exige (ADR 0005). Quem já está cadastrado no PHP precisaria informar o CPF ao migrar.

## Caminho sugerido
1. **Hoje:** fechar U1 a U8 no servidor do app PHP, ou tirá-lo do ar se não estiver em uso pelos hóspedes.
2. **Decidir** as perguntas 53 a 57.
3. **Migrar** os hóspedes do app PHP:
   - nome, e-mail e telefone; o CPF é pedido no primeiro acesso;
   - saldo de pontos convertido num lançamento de ajuste com validade (regra a decidir, pergunta 57), depois de limpar os pontos obtidos por falha.
4. **Trazer as funcionalidades,** cada uma com ADR e testes:
   - check-in por QR de uso único;
   - recreação e informações úteis na "Minha conta";
   - app instalável.
5. **Desligar o app PHP** e publicar este projeto no GitHub da organização, como repositório **privado**.
