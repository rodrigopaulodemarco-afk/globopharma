# Globo Pharma OL

Portal de pedidos (Loja) e painel administrativo da Globo Pharma, hospedado no Netlify.

Site em produção: https://globopharma.netlify.app

## Estrutura

```
index.html      Página inicial (escolha entre Loja e Administração)
loja.html       Portal de pedidos do cliente
admin.html      Painel administrativo
assets/         Imagens e logotipos
db/             Schema e conexão do banco (Drizzle ORM + Netlify DB / Postgres)
netlify/
  functions/    Netlify Functions (API)
  database/     Migrações do banco
netlify.toml    Configuração do Netlify
```

## API (Netlify Functions)

| Função | Responsabilidade |
| --- | --- |
| `auth.mts` | Login, cadastro e senhas (hash scrypt) |
| `acessos.mts` | Solicitações e liberações de acesso |
| `clientes.mts` | Cadastro de clientes / farmácias |
| `produtos.mts` | Catálogo de produtos |
| `pedidos.mts` | Criação e consulta de pedidos |
| `novo-pedido-id.mts` | Geração do número do pedido |
| `config.mts` | Configurações gerais |
| `consentimentos.mts` | Registro de consentimento LGPD |
| `enviar-email.mts` | Envio de e-mails |
| `submission-created.mts` | Gatilho de formulários do Netlify |

## Banco de dados

Postgres gerenciado pelo Netlify DB, acessado via Drizzle ORM.
Tabelas: `pedidos`, `produtos`, `acessos`, `configuracoes`, `clientes`,
`consentimentos_lgpd`, `usuarios`, `usuario_farmacias`.

As credenciais do banco vêm de variáveis de ambiente do Netlify — não há
segredos neste repositório.

## Rodando localmente

```bash
npm install
npx netlify dev
```

## Migrações

```bash
npx drizzle-kit generate   # gera nova migração em netlify/database/migrations
```
