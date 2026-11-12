# Perguntas em aberto sobre o hotel

_Atualizado: 2026-11-12_

Decisões que dependem do hotel (diretoria, marketing, jurídico, recepção). Enquanto não houver resposta, o sistema segue o "padrão atual". Ao decidir, registre num ADR novo e mova a pergunta para "Respondidas".

## Em aberto

| Nº | Pergunta | Origem (ADR) | Padrão atual | Impacto |
|---|---|---|---|---|
| 1 | Como acessar a API do Erbon (documentação, credenciais de teste, webhooks ou consulta periódica)? | 0004 | Estadias só por lançamento manual na recepção | Sem isso não há importação automática |
| 2 | As diárias pontuam? A base é o valor líquido de impostos e da taxa de serviço? | 0003 | Diárias pontuam, sobre o valor líquido lançado | Muda quanto cada estadia rende |
| 3 | Ocupação e % de hóspedes recorrentes hoje? | 0004 | Sem dado | Calibra metas de nível e custo do programa |
| 4 | Aceita baixar Ouro/Diamante (ex.: 6.000 e 12.000) e subir o valor do ponto? | 0003, 0004 | Prata 3.000, Ouro 8.000, Diamante 20.000; 1 ponto ≈ R$ 0,02 | Atratividade e custo do programa |
| 5 | Quer campanhas sazonais fixas (alta/baixa temporada)? Ou retirar "campanhas" dos textos? | 0003 | Campanhas **não implementadas**; aparecem nos textos | Promessa ao hóspede sem sistema por trás |
| 6 | Bônus de aniversário (500 pontos): implementar ou retirar dos textos? | 0003, 0008 | **Não implementado**; aparece nos textos | Promessa ao hóspede sem sistema por trás |
| 7 | Avisos de vencimento (90 e 30 dias): implementar o envio ou retirar dos textos? Por qual canal e ferramenta (e-mail, WhatsApp)? | 0003, 0008 | Avisos só **gravados**, não enviados | Promessa "a gente avisa" não é cumprida |
| 8 | O aviso de vencimento é mensagem de serviço (vai para todos) ou de marketing (só para quem aceitou)? | 0008 | Indefinido (nada é enviado) | LGPD e alcance do aviso |
| 9 | Estorno depois do check-out: implementar a redução dos pontos já creditados ou retirar dos textos? | 0003, 0007 | Só estorno lançado **antes** do check-out, na mesma categoria | Hóspede pode ficar com pontos de valor devolvido |
| 10 | Quais benefícios reais por nível o hotel consegue entregar (late check-out, upgrade, café, spa)? | 0003 | Benefícios entre [colchetes] nos textos | Conteúdo comercial |
| 11 | Parceiros externos (companhias aéreas, restaurantes locais)? | — | Nenhum | Escopo futuro |
| 12 | Quem aprova ajustes manuais de pontos? | 0010 | Não há rota de ajuste manual | Controle de fraude |
| 13 | Pontos podem ser transferidos entre hóspedes/família? | 0003 | Não (pessoais e intransferíveis, "a confirmar" nos textos) | Regulamento |
| 14 | Limites de valor por estadia lançada manualmente? A estadia manual deve exigir gerente (ou dupla conferência)? | 0010, revisão geral | Recepção lança e faz check-out; teto técnico R$ 200.000 por linha e R$ 500.000 por estadia | Risco de fraude interna (pontos com valores livres) |
| 15 | Quantos dias para trás a recepção pode lançar uma estadia? | revisão geral (0011) | 30 dias após o check-out; estadia inteiramente anterior ao cadastro **nunca** pontua | Lançamentos esquecidos x fraude |
| 16 | Hóspede com dois quartos ao mesmo tempo: como lançar? | revisão geral (0011) | Permitido só com número da reserva (`externalRef`) diferente; sem número, período sobreposto é recusado como duplicado | Recepção precisa informar o nº da reserva |
| 17 | Manter o nível com consumo pequeno renova a validade por mais 12 meses? | 0007, 0008 | Sim: manter o nível renova `tierValidUntil` | Custo do programa (nível alto "eterno") |
| 18 | Como confirmar que quem cadastra é dono do CPF/e-mail? | 0006, revisão geral | Sem confirmação; o cadastro responde "já existe cadastro", o que revela quem é hóspede | Privacidade (enumeração) e contas falsas |
| 19 | Idade mínima: exigir maioridade ou responsável legal? | 0006 | Sem regra | LGPD (menores) |
| 20 | Regras de exclusão de dados (LGPD): o que apagar, em quanto tempo, e se libera o recadastro com o mesmo CPF? | 0006 | Campo `deletedAt` existe, mas não há rota de anonimização | Direitos do titular (acesso, correção, exclusão) |
| 21 | Registrar a versão do regulamento aceita e a data do consentimento de marketing em separado? | 0006 | Só `marketingConsent` e `consentAt` | Prova de consentimento (LGPD) |
| 22 | Chave do HMAC do CPF: guardar versão da chave? O hotel precisa ver o CPF completo (exigiria criptografia reversível)? | 0006 | Chave única, sem versão; CPF não recuperável (só os 4 últimos) | Troca de chave e exportação de dados |
| 23 | Validade do voucher de resgate (prazo para usar) e estoque/limite por prêmio? | 0009 | Sem prazo e sem estoque | Passivo de pontos e disponibilidade |
| 24 | Segundo fator (2FA) para gerente e administrador? | 0010 | Só usuário e senha | Segurança das contas com mais poder |
| 25 | Por quanto tempo guardar os registros de auditoria? | 0010 | Sem prazo (guarda tudo) | LGPD e espaço em disco |
| 26 | Administrador pode redefinir a senha de outro administrador? | 0010 | Permitido (fica registrado e derruba as sessões do outro) | Alternativa: só pela linha de comando |
| 27 | A auditoria precisa ficar na mesma transação da operação (conformidade)? | 0010 | Gravada logo depois; queda entre as duas pode deixar operação sem registro | Exigência de conformidade |
| 28 | Limite de indicações por código de indicação? | 0006 | Sem limite (boas-vindas só após o 1º check-out) | Abuso de indicação |

## Respondidas
- Stack: TypeScript + PostgreSQL (ADR 0002). Estadias via PMS e manual. Resort de lazer único. PMS Erbon com folio por categoria. Diária média R$ 700. Todos os hóspedes cadastrados entram, inclusive OTA (ADR 0004).
- **CPF obrigatório** no cadastro; estrangeiro usa passaporte (ADR 0005).
- **Bônus de indicação** (500 para o indicado, 1.000 para o indicador) só após o 1º check-out com receita do indicado (ADRs 0006 e 0007).
- **Nível só por pontos-base**: conta o valor gasto, sem multiplicador do nível; bônus não contam (ADR 0003/0007).
- **Estadias anteriores ao cadastro não pontuam** (ADR 0004).
