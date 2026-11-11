# 0005 — CPF obrigatório no cadastro

- **Status**: Aceita
- **Data**: 2026-11-11

## Decisão
- O CPF é obrigatório no cadastro do programa e serve de chave para casar o hóspede com as estadias do Erbon.
- Estrangeiros sem CPF informam o passaporte (opção no formulário), que ocupa o mesmo campo `Guest.document`.
- `Guest.document` passa a ser obrigatório e único. O CPF é validado pelos dígitos verificadores.

## Consequências
- Dado pessoal sensível do ponto de vista de segurança: armazenar com proteção (criptografia/hash para busca) e coletar só o necessário (LGPD). Registrar na auditoria.
- Duplicidade: o mesmo CPF não pode ter dois cadastros.
