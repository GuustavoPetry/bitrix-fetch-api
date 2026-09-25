# Bitrix24 REST Console

Aplicativo de prova de conceito estilo Insomnia que roda como **aplicativo local dentro do Bitrix24**. Permite executar qualquer método da REST API do portal (sempre via `POST`) usando a sessão do usuário logado, sem necessidade de gerar tokens manualmente.

---

## Arquitetura

```
┌─────────────┐   POST (form) AUTH_ID, DOMAIN   ┌──────────────────┐
│  Bitrix24   │ ───────────────────────────────▶ │                  │
│ (iframe do  │                                  │  Fastify Server  │
│    app)     │ ◀─────────────────────────────── │   (src/app.ts)   │
└──────┬──────┘   HTML + CSS + JS (a UI)         │                  │
       │                                         │  memória:        │
       │  POST /call { method, params }          │  AUTH_ID/DOMAIN  │
       └────────────────────────────────────────▶│                  │
                                                 └────────┬─────────┘
                                                          │ POST
                                                          ▼
                                          https://DOMAIN/rest/<method>?auth=AUTH_ID
```

O fluxo tem três momentos:

1. **Instalação/abertura** — o Bitrix24 abre o app em um iframe fazendo `POST` para a URL do manipulador, enviando o contexto do usuário logado (`AUTH_ID`, `DOMAIN`, etc.) como `application/x-www-form-urlencoded`. O servidor guarda `AUTH_ID` e `DOMAIN` em memória e devolve a página HTML da UI.
2. **Interação** — o usuário digita o método REST e o Body JSON na UI. Ao enviar, o front-end chama `POST /call` no próprio servidor local com `{ method, params }`.
3. **Proxy** — o servidor repassa a chamada como `POST` para `https://<DOMAIN>/rest/<method>?auth=<AUTH_ID>` e devolve `{ status, data }` para a UI, que exibe a resposta.

O proxy no backend existe por dois motivos: o `AUTH_ID` nunca é exposto ao navegador, e não há problema de CORS (o navegador só fala com o servidor local).

### Estrutura de arquivos

```
├── src/
│   └── app.ts        # Servidor Fastify: contexto, proxy REST e statics
├── public/
│   ├── index.html    # Layout em duas colunas (request | response)
│   ├── style.css     # Tema escuro estilo Insomnia
│   └── app.js        # Lógica da UI (validação, editor, envio)
├── package.json
└── tsconfig.json
```

---

## Como cada parte funciona

### Backend — `src/app.ts`

Servidor Fastify na porta `3333`, com `@fastify/formbody` para parsear o POST de instalação do Bitrix. Rotas:

| Rota | Método | Função |
|---|---|---|
| `/local-app` | `POST` | Rota do manipulador. Recebe `AUTH_ID` e `DOMAIN` do Bitrix24, guarda em variáveis em memória e devolve o HTML da UI. |
| `/` | `GET` | Serve a mesma UI para testes locais no navegador (sem contexto Bitrix). |
| `/app.js`, `/style.css` | `GET` | Arquivos estáticos da UI, servidos com `readFile` (sem dependência de plugin de estáticos). |
| `/context` | `GET` | Retorna `{ domain, authenticated }` para a UI exibir o status da conexão no cabeçalho. |
| `/call` | `POST` | Proxy REST. Recebe `{ method, params }`, valida a entrada e faz `POST` com JSON para `https://DOMAIN/rest/<method>?auth=AUTH_ID`. Retorna `{ status, data }`. |

Validações do `/call`:

- `method` vazio → `400`;
- sem `AUTH_ID` (app aberto fora do Bitrix) → `401` com mensagem orientando a abrir dentro do Bitrix24;
- falha de rede ao chamar o portal → `502`.

> **Limitação consciente (POC):** o token fica em uma variável global em memória. Ou seja, existe **uma única sessão** — o último usuário que abriu o app sobrescreve o anterior, e reiniciar o servidor derruba a sessão. Para produção seria necessário associar o token a uma sessão por usuário (cookie/`member_id`).

### Frontend — `public/`

Página única em duas colunas, sem framework (JS vanilla):

**Coluna de requisição:**

- Tag fixa `POST` (regra do app: toda chamada sai como POST) + campo de texto livre para o método REST (ex.: `crm.deal.list`).
- Textarea de Body JSON com **highlight de sintaxe** (chaves, strings, números, booleanos/null coloridos — implementado com um `<pre>` colorido atrás do textarea transparente, técnica que não exige biblioteca) e:
  - **Validação em tempo real** — a cada tecla, tenta `JSON.parse`; em erro, mostra borda vermelha e a mensagem de sintaxe do parser abaixo do campo. Campo vazio é válido: a requisição sai sem body.
  - **Auto-fechamento** de `{`, `[` e `"`; digitar o fechamento sobre um caractere auto-fechado apenas pula o cursor.
  - **Indentação automática** — Enter mantém a indentação da linha atual; dentro de um par `{}`/`[]` na mesma linha, quebra o bloco indentando cursor e fechamento. `Tab` insere 2 espaços.
  - Botão **Formatar** — reindenta o JSON com `JSON.stringify(..., null, 2)`; dá feedback no próprio botão (`Formatado!`, `JSON inválido`, `Campo vazio`).
- Botão **▶** pequeno ao lado do campo do método. Atalhos: **Enter** com o foco no campo do método, ou **Ctrl+Enter** de qualquer lugar.

**Coluna de resposta:**

- Badge com o `HTTP status` colorido por faixa — verde (2xx), azul (3xx), amarelo (4xx), vermelho (5xx ou erro de rede) — e tempo da requisição em ms. O corpo da resposta é exibido **sempre**, independente de sucesso ou erro.
- `<pre>` com a resposta formatada (indent 2) e com o mesmo highlight de sintaxe do Body, com scroll.
- Botão **Copiar** para a área de transferência, com fallback via `execCommand("copy")` — necessário porque `navigator.clipboard` é bloqueado em iframes sem permissão de clipboard, como o do Bitrix24.

**Cabeçalho:** mostra o status do contexto consultando `GET /context` — verde (`conectado: <domínio>`) quando há `AUTH_ID`, amarelo avisando para abrir dentro do Bitrix24 quando não há.

---

## Instalação e uso no Bitrix24

### Pré-requisitos

- Node.js 18+.
- Um portal Bitrix24 com permissão para adicionar aplicativos locais.
- Uma URL pública com **HTTPS** apontando para o servidor local — o Bitrix24 não aceita `http://localhost` como manipulador. A forma mais simples é um túnel:

```bash
ngrok http 3333
# ou
npx localtunnel --port 3333
```

Anote a URL gerada (ex.: `https://abcd1234.ngrok.io`).

### 1. Subir o servidor

```bash
npm install
npm run dev        # ou npm run dev:watch
```

Servidor em `http://localhost:3333`, exposto publicamente pelo túnel.

### 2. Criar o aplicativo local no portal

1. No menu lateral do Bitrix24, vá em **Aplicativos → Desenvolvedores** (ou **Recursos do desenvolvedor → Outros → Aplicativo local**).
2. Escolha **Aplicativo local** e preencha:
   - **Nome**: ex. `REST Console`.
   - **URL do manipulador**: `https://<sua-url-do-tunel>/local-app`
   - Marque a opção de o app usar **somente a API** / não precisa de URL de instalação separada.
3. Em **escopos (permissões)**, selecione os que pretende testar — ex.: `CRM`, `Usuário`, `Tarefas`. Os métodos chamados no console só funcionarão se o escopo correspondente estiver liberado.
4. Salve. O app passa a aparecer no menu **Aplicativos** do portal.

### 3. Usar

1. Abra o app pelo menu do Bitrix24. O portal faz o POST de contexto, o servidor guarda o `AUTH_ID` e o cabeçalho da UI fica verde: `conectado: <seu-domínio>`.
2. Digite o método, por exemplo `user.current` ou `crm.deal.list`.
3. Escreva o Body JSON (ou deixe vazio para enviar sem body), por exemplo:

```json
{
  "select": ["ID", "TITLE", "STAGE_ID"],
  "order": { "ID": "DESC" }
}
```

4. Clique no botão **▶**, ou pressione **Enter** no campo do método (ou `Ctrl+Enter`). A resposta aparece na coluna da direita com status e tempo.

### Testando fora do Bitrix24

Acesse `http://localhost:3333` direto no navegador. A UI abre normalmente, mas o cabeçalho fica amarelo (`sem AUTH_ID`) e qualquer envio retorna `401`. Também é possível simular o POST de instalação:

```bash
curl -X POST http://localhost:3333/local-app \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "AUTH_ID=<token>&DOMAIN=<seu-portal>.bitrix24.com.br"
```

---

## Observações

- Toda requisição ao portal sai como `POST` com corpo JSON — inclusive métodos de listagem, que no Bitrix24 aceitam POST normalmente.
- Tokens `AUTH_ID` do Bitrix24 expiram (tipicamente em 1 hora). Quando expirar, basta reabrir o app no portal para injetar um novo contexto (renovação via refresh token não foi implementada por ser POC).
- Como o token fica em memória no servidor, qualquer pessoa com acesso à URL usa a sessão de quem abriu o app por último. Não exponha em ambiente compartilhado.
