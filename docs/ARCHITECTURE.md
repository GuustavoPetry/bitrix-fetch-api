# Bitrix24 REST Console — Documentação Técnica

> Documento técnico gerado a partir da análise do código-fonte do projeto `oauth-bitrix`.
> Última atualização: 2026-09-28 (inclui Redis, bot de IA com Kimi API e widget de chat).

## 1. Visão geral

O `oauth-bitrix` é um **aplicativo local do Bitrix24** que funciona como um cliente REST estilo Insomnia/Postman, embutido dentro de um iframe do portal Bitrix24, com um assistente de IA embutido (o **Bitrix Copilot**) capaz de montar e disparar chamadas da API a partir de um pedido em linguagem natural.

Ele permite que o usuário logado no Bitrix24 execute qualquer método da REST API do portal (sempre via `POST`), sem precisar gerar ou copiar tokens manualmente — o token de sessão (`AUTH_ID`) é capturado automaticamente quando o Bitrix24 abre o app e fica guardado no Redis, associado a uma sessão por usuário (cookie).

Não há OAuth 2.0 tradicional (authorization code / client_secret) implementado: o mecanismo usado é o de **aplicativo local (local app)** do Bitrix24, no qual o próprio portal injeta o contexto de autenticação do usuário (`AUTH_ID`/`DOMAIN`) via `POST` no momento em que o app é aberto dentro do menu **Aplicativos**.

### 1.1 Objetivo do app

- Testar métodos da REST API de um portal Bitrix24 (ex.: `crm.deal.list`, `user.current`) com Body JSON livre.
- Servir como ferramenta de debug/desenvolvimento para quem constrói integrações com Bitrix24.
- Permitir que um usuário sem conhecimento profundo da API descreva o que quer fazer em português e o bot monte o método/payload correspondente.

### 1.2 Stack tecnológica

| Camada | Tecnologia |
|---|---|
| Runtime | Node.js (18+, testado com 22) |
| Linguagem | TypeScript, executado diretamente via `tsx` (sem build/transpile prévio) |
| Servidor HTTP | [Fastify](https://fastify.dev/) v5, organizado em plugins (`fastify-plugin`) |
| Sessão | Cookie assinado (`@fastify/cookie`) + Redis (`ioredis`) |
| IA / chat | SDK da OpenAI (`openai`) apontando para a **Kimi API** (endpoint compatível), com tool/function calling |
| Parsing de formulário | `@fastify/formbody` (necessário para receber o `POST` `application/x-www-form-urlencoded` que o Bitrix24 envia na abertura do app) |
| Variáveis de ambiente | `dotenv` |
| Front-end | HTML + CSS + JavaScript vanilla (sem framework, sem bundler) |
| Gerenciador de pacotes | npm |

## 2. Estrutura de arquivos

```
oauth-bitrix/
├── src/
│   ├── app.ts                  # Bootstrap Fastify: registra plugins/rotas e sobe o servidor
│   ├── env.ts                  # Leitura/normalização de variáveis de ambiente (.env)
│   ├── plugins/
│   │   ├── redis.ts            # Decora app.redis (ioredis)
│   │   ├── session.ts          # Cookie assinado de sessão por usuário (@fastify/cookie)
│   │   └── openai.ts           # Decora app.openai (SDK OpenAI apontando para a Kimi API)
│   ├── routes/
│   │   └── chat.ts             # POST /api/chat — rota do bot de IA
│   └── services/
│       ├── bitrixSession.ts    # Leitura/escrita do contexto (AUTH_ID/DOMAIN) no Redis
│       ├── bitrixClient.ts     # Execução de métodos REST do Bitrix24 (usado por /call e pelo bot)
│       ├── chatAgent.ts        # Prompt de sistema, tool schema e sanitização do histórico do chat
│       ├── bitrixKnowledge.ts  # Catálogo de métodos conhecidos, usado como contexto do bot
│       └── bitrixMcp.ts        # Integração com servidor MCP do Bitrix24 (stub, pendente)
├── public/
│   ├── index.html    # Layout em duas colunas (requisição | resposta) + widget de chat
│   ├── style.css     # Tema escuro estilo Insomnia + estilos do widget de chat
│   ├── app.js        # Lógica da UI principal: editor JSON, validação, envio, highlight
│   └── chat.js       # Lógica do widget de chat flutuante (Bitrix Copilot)
├── docs/
│   └── ARCHITECTURE.md   # Este documento
├── package.json
├── tsconfig.json
├── docker-compose.yml     # Sobe um Redis local para desenvolvimento
├── .env.example           # Modelo de variáveis de ambiente
├── .gitignore             # ignora node_modules e .env
└── README.md
```

Não há diretório `dist/` nem etapa de build: o `tsconfig.json` define apenas opções de checagem de tipos (`strict`, `noUncheckedIndexedAccess`, `esModuleInterop`, etc.), e a execução em desenvolvimento roda os `.ts` diretamente via `tsx`.

## 3. Arquitetura e fluxo de dados

```
┌─────────────┐   POST (form) AUTH_ID, DOMAIN   ┌───────────────────────────┐
│  Bitrix24   │ ───────────────────────────────▶ │                           │
│ (iframe do  │   + cookie de sessão (bx_session) │      Fastify Server       │
│    app)     │ ◀─────────────────────────────── │  (src/app.ts + plugins)   │
└──────┬──────┘   HTML + CSS + JS (a UI)          │                           │
       │                                          │   Redis: sessão do       │
       │  POST /call { method, params }           │   usuário (AUTH_ID/      │
       ├─────────────────────────────────────────▶│   DOMAIN), TTL 1h        │
       │                                          │                           │
       │  POST /api/chat { messages }             │   Kimi API (tool         │
       ├─────────────────────────────────────────▶│   calling) decide        │
       │  ◀── { method, params,                   │   method + params        │
       │        requiresConfirmation }             │                           │
       └─────────────────────────────────────────▶└─────────────┬─────────────┘
                                                                  │ POST
                                                                  ▼
                                           https://DOMAIN/rest/<method>?auth=AUTH_ID
```

O fluxo principal (chamada manual) ocorre em três momentos:

1. **Instalação/abertura do app** — o Bitrix24 faz `POST application/x-www-form-urlencoded` para a URL do manipulador (`/local-app`), enviando `AUTH_ID`, `DOMAIN` e outros campos de contexto do usuário logado. O servidor identifica a sessão do usuário (cookie `bx_session`, criado se ainda não existir) e salva `AUTH_ID`/`DOMAIN` no Redis sob essa sessão, devolvendo o HTML da UI.
2. **Interação do usuário** — o usuário digita o método REST e o Body JSON na UI (ou o bot de IA preenche esses campos por ele — ver seção 4.4). Ao enviar (clique, Enter ou Ctrl+Enter), o front-end faz `POST /call` no próprio servidor local com `{ method, params }`.
3. **Proxy para o Bitrix24** — o servidor busca o `AUTH_ID`/`DOMAIN` daquela sessão no Redis, repassa a chamada como `POST https://<DOMAIN>/rest/<method>?auth=<AUTH_ID>` com o `params` serializado em JSON, e devolve `{ status, data }` para a UI exibir.

O proxy no backend existe por dois motivos: (a) o `AUTH_ID` nunca é exposto ao navegador/JS do iframe; (b) evita problemas de CORS, já que o navegador só conversa com o servidor local, e este conversa com o Bitrix24 via `fetch` server-side.

O fluxo do bot de IA (chat) é descrito em detalhe na seção 4.4 — ele não chama o Bitrix24 diretamente; apenas decide `method`/`params` e devolve para o frontend, que reaproveita o mesmo caminho `/call` acima.

## 4. Backend

O backend deixou de ser um único arquivo monolítico: `src/app.ts` agora só faz o bootstrap (registra plugins e rotas, sobe o servidor), e a lógica fica dividida em `plugins/` (infraestrutura: Redis, sessão, cliente OpenAI) e `services/` (regras de negócio: sessão Bitrix, execução de métodos, conhecimento do bot).

### 4.1 Sessão por usuário (cookie + Redis)

A versão original guardava `AUTH_ID`/`DOMAIN` em duas variáveis globais em memória — uma única sessão para todo o servidor. Isso foi substituído por:

- **`src/plugins/session.ts`**: registra `@fastify/cookie` e, em um hook `onRequest`, lê ou gera um cookie assinado (`bx_session`, nome configurável via `SESSION_COOKIE_NAME`) por usuário/navegador. Como o app roda dentro de um iframe de terceiros no Bitrix24, o cookie usa `SameSite=None; Secure; HttpOnly`, o que exige HTTPS (já garantido pelo túnel ngrok/localtunnel). **Observação**: navegadores com política estrita de cookies de terceiros (ex.: Safari ITP) podem bloquear esse cookie — não testado ainda contra o Bitrix24 real.
- **`src/plugins/redis.ts`**: decora `app.redis` com um client `ioredis`, configurado com `maxRetriesPerRequest: 1` e um `retryStrategy` com backoff limitado a 2s — se o Redis cair, os comandos falham rápido (em vez do padrão do `ioredis`, até 20 tentativas por comando, o que deixaria a requisição pendurada por vários segundos).
- **`src/services/bitrixSession.ts`**: `saveBitrixSession`/`getBitrixSession` leem/gravam `{ authId, domain }` no Redis sob a chave `bitrix:session:<sessionId>`, com TTL igual a `SESSION_TTL_SECONDS` (padrão 3600s/1h, espelhando a expiração real do `AUTH_ID` do Bitrix24). Falhas de leitura/escrita no Redis são capturadas e logadas (`app.log.warn`) sem derrubar a requisição — na prática, se o Redis estiver fora do ar, o app se comporta como se nenhuma sessão estivesse autenticada (degradação graciosa, não um erro 500).

Cada usuário que abre o app agora tem seu próprio contexto persistido — múltiplos usuários podem usar o app ao mesmo tempo sem que um sobrescreva a sessão do outro, e a sessão sobrevive a um restart do processo Node (o que não acontecia na versão em memória).

### 4.2 Rotas

| Rota | Método | Descrição |
|---|---|---|
| `/local-app` | `POST` | Rota do manipulador (handler) do app local do Bitrix24. Recebe `AUTH_ID` e `DOMAIN` no corpo do formulário e salva no Redis via `saveBitrixSession`, associado à sessão (cookie) do usuário que abriu o app. Devolve o HTML da UI (`sendAppHtml`), com log estruturado (`[bitrix] contexto recebido`). |
| `/` | `GET` | Serve a mesma UI, para testes fora do Bitrix24 (sem contexto/`AUTH_ID`). |
| `/app.js` | `GET` | Serve `public/app.js` lendo o arquivo do disco a cada requisição (`readFile`), com `Content-Type: text/javascript` e `Cache-Control: no-store`. |
| `/chat.js` | `GET` | Serve `public/chat.js` da mesma forma — lógica do widget de chat flutuante. |
| `/style.css` | `GET` | Serve `public/style.css` da mesma forma, com `Content-Type: text/css`. |
| `/context` | `GET` | Retorna `{ domain, authenticated }` lendo a sessão do Redis, usado pela UI para exibir o status da conexão no cabeçalho. |
| `/call` | `POST` | Proxy REST. Recebe `{ method, params }` no corpo JSON e repassa a chamada ao Bitrix24 usando o `AUTH_ID`/`DOMAIN` da sessão atual. **Único caminho de execução real** de métodos do Bitrix24 em todo o projeto. |
| `/api/chat` | `POST` | Rota do bot de IA (Bitrix Copilot). Recebe `{ messages }` (histórico da conversa) e devolve `{ reply, method, params, requiresConfirmation }` — não executa nada no Bitrix24 (ver seção 4.4). |

Não há plugin de arquivos estáticos (`@fastify/static`); os arquivos `app.js`/`chat.js`/`style.css` são lidos manualmente via `node:fs/promises` a cada request (sem cache, garantindo que alterações no front-end apareçam sem reiniciar o servidor).

### 4.3 Execução de métodos REST — `src/services/bitrixClient.ts`

Ponto único de execução de chamadas ao Bitrix24, usado pela rota `/call`:

```ts
const method = (rawMethod ?? "").trim().replace(/^\/+/, "");
```

- **Validações de entrada:**
  - `method` vazio (após trim e remoção de barras iniciais) → `{ status: 400, data: { error: "Informe o método REST." } }`.
  - Ausência de `AUTH_ID` na sessão atual (app aberto fora do Bitrix24, ou sessão expirada/nunca recebida) → `{ status: 401, ... }` orientando abrir o app dentro do Bitrix24.
- **Chamada ao portal:** monta `https://${domain}/rest/${method}?auth=${authId}` e faz `fetch` com `method: "POST"`. Se `params` estiver definido, envia `Content-Type: application/json` e `body: JSON.stringify(params)`; se `params` for `undefined` (Body vazio na UI), a requisição sai sem corpo e sem `Content-Type`. Bitrix aceita `POST` também para métodos de listagem/consulta, então esse comportamento cobre todos os tipos de método REST.
- **Tratamento de resposta:** lê a resposta como texto (`response.text()`) e tenta `JSON.parse`; se falhar, mantém a string crua — garante que erros não-JSON (páginas HTML de gateway, timeouts, etc.) também cheguem à UI para exibição.
- **Erros de rede:** qualquer exceção do `fetch` (DNS, timeout, TLS, etc.) é capturada e responde `502` com a mensagem do erro.
- **Contrato HTTP do wrapper**: a rota `/call` sempre responde HTTP 200 no envelope Fastify para uma chamada bem-sucedida ao Bitrix24 (mesmo que o Bitrix tenha respondido 403/404/etc.) — o status "real" fica embutido no campo `status` do JSON, que é o que a UI lê para colorir o badge. Erros de validação local (400/401) e de rede (502) usam o HTTP real do Fastify.
- **`isReadOnlyMethod(method)`**: função auxiliar que classifica um método como "somente leitura" via regex (`.list`, `.get`, `.fields`, `.current`, `.count`, `.ping`). Usada exclusivamente pelo fluxo do bot de IA (seção 4.4) para decidir se uma chamada sugerida pode ser disparada automaticamente ou exige confirmação do usuário.

### 4.4 Bot de IA — Bitrix Copilot (`src/routes/chat.ts`, `src/services/chatAgent.ts`)

O bot roda na **Kimi API** através do SDK da OpenAI (`src/plugins/openai.ts` decora `app.openai` com `baseURL` apontando para o endpoint da Kimi, compatível com o formato OpenAI, incluindo tool/function calling), configurável via `OPENAI_API_KEY`, `OPENAI_URL` e `OPENAI_MODEL`.

Uma única tool é exposta ao modelo (`src/services/chatAgent.ts`):

```
call_bitrix_method(method: string, params?: object)
```

O modelo **nunca executa a chamada** — apenas decide `method` e `params`. O prompt de sistema (`buildSystemPrompt`) instrui o modelo a:

- perguntar ao usuário em vez de inventar nomes de métodos/campos quando não tiver certeza;
- recusar de forma breve e educada qualquer pedido fora do escopo de montar/executar métodos REST do Bitrix24 (conversa geral, outros assuntos, outras APIs, código não relacionado);
- nunca afirmar que já executou algo sozinho — quem executa é sempre o console, via `/call`.

O contexto de "conhecimento" do bot vem de `src/services/bitrixKnowledge.ts` (catálogo estático de módulos/métodos comuns do Bitrix24: CRM, usuários, tarefas, disco, calendário, mensageria interna), preparado para ser complementado por uma consulta ao servidor MCP do Bitrix24 assim que essa integração for implementada (ver 4.5).

**Fluxo da rota `POST /api/chat`:**

1. Responde `503` se `OPENAI_API_KEY` não estiver configurada.
2. Sanitiza o histórico recebido (`sanitizeChatMessages`): só aceita mensagens `user`/`assistant` com conteúdo string, limitado às últimas 20 (contenção de custo/tokens) — o histórico da conversa vive só no navegador, não é persistido no servidor.
3. Chama `app.openai.chat.completions.create` com o histórico + prompt de sistema + a tool `call_bitrix_method` (`tool_choice: "auto"`).
4. Se o modelo **não** chamar a tool, devolve a resposta conversacional (`{ reply, method: null, params: null, requiresConfirmation: false }`) — é o caminho usado tanto para respostas normais quanto para a recusa por estar fora de escopo.
5. Se chamar a tool, valida que `method` tem o formato `modulo.entidade.acao` (regex); se inválido ou malformado, pede mais detalhes ao usuário em vez de seguir adiante.
6. Caso contrário, devolve `{ reply, method, params, requiresConfirmation }`, onde `requiresConfirmation = !isReadOnlyMethod(method)`.

**Importante**: esta rota **não chama o Bitrix24** em nenhum momento. Quem decide se a chamada é automática ou exige clique de confirmação, e quem efetivamente aciona `/call`, é o frontend (seção 5.4) — preservando `/call` como único caminho de execução real de qualquer método, inclusive os sugeridos pelo bot.

### 4.5 Servidor MCP do Bitrix24 — pendente (`src/services/bitrixMcp.ts`)

Ponto de extensão reservado para consultar um servidor MCP do Bitrix24 como fonte adicional de documentação/descoberta de métodos. Hoje é um stub:

- `isMcpConfigured()` retorna `false` enquanto `BITRIX_MCP_URL` não estiver definido no `.env`.
- `queryMcpKnowledge()` sempre retorna `null` nesse caso.

`bitrixKnowledge.ts` já está preparado para combinar o catálogo estático com o resultado dessa consulta assim que ela for implementada, sem precisar mudar a rota de chat. Ainda falta definir: qual servidor MCP do Bitrix24 será usado (pacote/URL), qual transporte ele expõe (stdio, SSE ou HTTP streamable — o cliente oficial seria o pacote `@modelcontextprotocol/sdk`, ainda não adicionado às dependências) e as credenciais de acesso.

O contrato de design já está fixado e não deve mudar quando essa integração for implementada: o MCP serve **somente** como fonte de contexto/documentação para o bot — a execução de qualquer método continua exclusivamente através da rota `/call` (seção 4.3).

## 5. Frontend (`public/`)

Página única (SPA simples), sem framework, com layout de duas colunas: **requisição** (esquerda) e **resposta** (direita), mais um widget de chat flutuante sobreposto.

### 5.1 `index.html`

- Cabeçalho (`<header>`) com título e um badge `#context` que mostra o status da conexão com o Bitrix24 (preenchido via JS após consultar `/context`).
- Coluna de requisição:
  - Tag fixa `POST` (toda chamada sai como `POST`, por regra do app).
  - Input de texto livre `#method` para o método REST (ex.: `crm.deal.list`).
  - Botão `#send` (▶) para disparar a chamada.
  - Editor de Body JSON: um `<pre id="body-highlight">` sobreposto por um `<textarea id="body">` transparente, técnica usada para dar highlight de sintaxe sem biblioteca externa.
  - Div `#json-error` para mensagens de erro de parsing.
- Coluna de resposta:
  - Badge `#status` (HTTP status colorido) e `#elapsed` (tempo da requisição).
  - Botão `#copy` para copiar a resposta.
  - `<pre id="response">` com a resposta formatada.
- **Widget de chat** (novo): botão flutuante `#chat-toggle` (💬, canto inferior direito) e painel `#chat-panel` (oculto por padrão) com histórico de mensagens (`#chat-messages`) e formulário de envio (`#chat-form` + `#chat-input`).
- Referencia `/style.css`, `/app.js` e `/chat.js` (todos servidos pelo backend, não por CDN).

### 5.2 `app.js` — lógica da UI principal

Organizado em seções por comentário, sem módulos/build step (script único carregado via `<script src="/app.js">`):

**a) Contexto Bitrix24**
No load, faz `fetch("/context")` e atualiza o badge do cabeçalho: verde (`badge-ok`, "conectado: <domínio>") se `authenticated`, amarelo (`badge-warn`) caso contrário, vermelho (`badge-err`) se a própria requisição falhar.

**b) Highlight de sintaxe JSON**
Função `highlightJson(text)` usa uma regex (`JSON_TOKEN`) para identificar strings (diferenciando chaves de objeto — seguidas de `:` — de valores string), booleanos/`null` e números, envolvendo cada token em um `<span>` com classe (`tk-key`, `tk-string`, `tk-bool`, `tk-number`). O texto é escapado (`escapeHtml`) antes de aplicar os spans, prevenindo XSS ao renderizar tanto o Body digitado quanto a Response recebida. `updateBodyHighlight()` sincroniza o `<pre>` de fundo com o conteúdo do textarea a cada edição; `syncBodyScroll()` mantém os scrolls do `<pre>` e do `<textarea>` alinhados.

**c) Validação de JSON em tempo real**
`validateJson(showEmptyOk)` tenta `JSON.parse` do conteúdo do Body a cada tecla (`input` → `refresh()`); campo vazio é considerado válido (a requisição sai sem body); em caso de erro, marca o textarea com classe `invalid` (borda vermelha) e exibe a mensagem de erro do parser em `#json-error`.

**d) Facilitadores de edição (dentro do textarea `#body`)**
- **Ctrl+Enter / Cmd+Enter**: dispara `send()` (capturado tanto no textarea quanto em nível de `document`, para funcionar de qualquer lugar da página).
- **Tab**: insere 2 espaços na posição do cursor (em vez de mover o foco).
- **Auto-fechamento** de `{`, `[` e `"`: ao digitar um desses caracteres com seleção vazia, insere o par de fechamento e posiciona o cursor entre eles.
- **Skip-over de fechamento**: digitar `}`, `]` ou `"` quando o próximo caractere já é esse mesmo fechamento apenas move o cursor, sem duplicar.
- **Enter com indentação inteligente**: mantém a indentação da linha atual; se o cursor está entre um par recém-aberto (`{}` ou `[]` vazio) na mesma linha, quebra em duas linhas indentando o conteúdo e o fechamento; caso contrário, mantém a indentação (+2 espaços extras se a linha anterior abre um bloco).

**e) Botão "Formatar"**
Reindenta o JSON do Body com `JSON.stringify(JSON.parse(text), null, 2)`. Dá feedback textual temporário no próprio botão (`flashButton`): `"Formatado!"`, `"JSON inválido"` ou `"Campo vazio"`, revertendo ao texto original após 1200 ms.

**f) Envio da requisição (`send()`)**
1. Valida que `method` não está vazio (foca o input caso esteja).
2. Valida o Body (`validateJson(true)`, aceitando vazio).
3. `params` é `JSON.parse(text)` se o Body não estiver vazio, ou `undefined` caso contrário.
4. Desabilita o botão de envio, limpa o badge de status e mostra "Enviando…" na área de resposta.
5. Faz `fetch("/call", { method: "POST", body: JSON.stringify({ method, params }) })`.
6. Mede o tempo decorrido com `performance.now()`.
7. Sempre exibe o `status` HTTP (badge colorido por faixa: 2xx verde, 3xx azul, 4xx amarelo, 5xx/erro vermelho) e o corpo da resposta (`renderResponse`), independentemente de sucesso ou erro — inclusive erros de rede no próprio `fetch`, capturados no `catch`.
8. Reabilita o botão de envio no `finally`.

Atalhos adicionais: **Enter** com foco no campo `#method` também dispara `send()` (com `stopPropagation()` para não disparar em duplicidade com o listener global de Ctrl+Enter).

**g) Copiar resposta**
Tenta `navigator.clipboard.writeText`; se falhar (bloqueado, por exemplo, dentro do iframe do Bitrix24 sem permissão de clipboard), usa um `<textarea>` temporário fora da tela + `document.execCommand("copy")` como fallback. Feedback visual via `flashButton`.

**h) Integração com o widget de chat (novo)**
No final do arquivo, `app.js` expõe duas funções para `chat.js` reaproveitar, sem duplicar a lógica de chamada HTTP:

```js
function setRequest(method, params) {
  methodInput.value = method || "";
  bodyInput.value = params !== undefined && params !== null ? JSON.stringify(params, null, 2) : "";
  refresh();
}

window.bitrixConsole = { setRequest, send };
```

`setRequest` preenche os campos de Método/Body (reaproveitando o highlight/validação já existentes) a partir de uma sugestão do bot; `send` é a mesma função descrita no item (f), agora acessível globalmente.

### 5.3 `chat.js` — widget de chat flutuante (Bitrix Copilot)

Controla a abertura/fechamento do painel (`#chat-toggle`/`#chat-close`) e mantém o histórico da conversa em uma variável JS local (array `history`) — **não é persistido** em lugar nenhum; recarregar a página apaga o histórico.

Ao enviar uma mensagem (`sendChatMessage`):

1. Adiciona a mensagem do usuário ao `history` e à lista visual (`#chat-messages`).
2. Faz `POST /api/chat` com `{ messages: history }` e mostra "Pensando…" enquanto aguarda.
3. Renderiza `payload.reply` como resposta do bot.
4. Se `payload.method` vier preenchido:
   - **`requiresConfirmation: false`** (método de leitura) — chama `window.bitrixConsole.setRequest(method, params)` e, em seguida, `window.bitrixConsole.send()` automaticamente: a mesma função usada pelo botão ▶ da UI principal, disparando `POST /call` normalmente e exibindo o resultado na coluna de resposta já existente.
   - **`requiresConfirmation: true`** (método de escrita/exclusão) — preenche os campos da mesma forma (`setRequest`), mas em vez de enviar automaticamente, renderiza um card de confirmação (`appendConfirmCard`) com o método, o payload formatado em JSON e um botão "Executar agora", que só então chama `send()`. Isso garante que nenhuma alteração/exclusão de dados no Bitrix24 acontece sem uma ação explícita do usuário.

`Enter` no campo de mensagem envia (sem `Shift`); `Shift+Enter` quebra linha.

### 5.4 `style.css`

Tema escuro estilo Insomnia/Postman. Define variáveis de cor para fundo, texto, bordas, e cores semânticas para os badges de status (`badge-ok`, `badge-info`, `badge-warn`, `badge-err`) e para os tokens de highlight de JSON (`tk-key`, `tk-string`, `tk-number`, `tk-bool`). Layout em grid/flex de duas colunas (`.pane`), com o textarea do Body e o `<pre>` de highlight sobrepostos (`.editor-wrap`) para simular um editor de código com syntax highlighting.

Seção adicional para o widget de chat: `.chat-fab` (botão flutuante circular), `.chat-panel` (painel fixo no canto inferior direito, com `max-height`/`max-width` responsivos), `.chat-messages` (bolhas `.chat-msg-user`/`.chat-msg-bot`) e `.chat-confirm` (card de confirmação com `<pre>` do payload e botão de execução). Todas as cores usam fallback (`var(--nome, #hex)`) para não depender de variáveis específicas do tema original.

## 6. Segurança e limitações conhecidas

- **Token nunca chega ao navegador**: o `AUTH_ID` é mantido apenas no servidor (Redis); a UI só troca `{ method, params }` e recebe `{ status, data }`, sem nunca ver o token — mitiga vazamento do token via DevTools/JS do iframe.
- **Sem HTTPS próprio**: o servidor roda em HTTP puro na porta 3333; o Bitrix24 exige HTTPS para o manipulador do app, por isso o uso de um túnel (ngrok/localtunnel) é necessário — o túnel é quem fornece TLS, não o próprio servidor.
- **Sem renovação de token**: quando o `AUTH_ID` expira (tipicamente 1h — o mesmo valor usado como TTL da chave no Redis), a única forma de renovar é reabrir o app dentro do portal Bitrix24 (não há fluxo de `refresh_token` implementado).
- **Cookie de sessão entre domínios**: `SameSite=None; Secure` é necessário porque o app roda dentro de um iframe de terceiros no Bitrix24, mas pode ser bloqueado por navegadores com política estrita de cookies de terceiros (ex.: Safari ITP) — ainda não validado contra um portal Bitrix24 real.
- **Degradação com Redis fora do ar**: se o Redis não estiver acessível, o app não derruba a requisição (erros são capturados e logados), mas também não consegue recuperar nenhuma sessão — o comportamento observado pelo usuário é idêntico ao de "abrir o app fora do Bitrix24" (401 em `/call`, `authenticated: false` em `/context`).
- **Bot de IA com acesso de execução real**: como o `AUTH_ID` usado nas chamadas tem os mesmos privilégios do usuário logado, o bot poderia, a partir de um pedido ambíguo, sugerir um método destrutivo (ex.: `crm.deal.delete`). A mitigação implementada é a exigência de confirmação explícita do usuário (clique) para qualquer método fora do padrão de leitura (`isReadOnlyMethod`) antes de chamar `/call` — ver seções 4.3–4.4 e 5.3. Essa classificação é feita por uma regex simples sobre o nome do método, não por uma lista fechada e curada manualmente; métodos de leitura com nomes fora do padrão esperado (`.list`/`.get`/`.fields`/`.current`/`.count`/`.ping`) seriam tratados como "escrita" (pedem confirmação à toa, falso positivo seguro) — o inverso (um método destrutivo escapar da classificação) exigiria um nome de método que "pareça" leitura, o que não é impossível de acontecer no catálogo real do Bitrix24 e vale revisão periódica dessa regex.
- **Guardrail de escopo do bot é apenas por prompt**: a instrução para o bot recusar assuntos fora da API do Bitrix24 está apenas no prompt de sistema — não há um filtro determinístico adicional. Um modelo mal-comportado ou um prompt-injection bem-sucedido (por exemplo, escondido dentro de um payload de resposta do Bitrix24 que o usuário cole na conversa) poderia, em tese, contornar essa instrução.
- **Histórico do chat não é persistido**: vive apenas em memória no navegador (variável JS) — não passa pelo Redis nem por nenhum banco. Não há, portanto, auditoria de quais mensagens/comandos foram sugeridos pelo bot ao longo do tempo.
- **`.env` está no `.gitignore`**: `SESSION_SECRET`, `OPENAI_API_KEY` e `BITRIX_MCP_TOKEN` nunca devem ser commitados; o repositório só versiona `.env.example` (sem valores reais).

## 7. Execução e integração com o Bitrix24

### 7.1 Scripts (`package.json`)

| Script | Comando | Descrição |
|---|---|---|
| `dev` | `tsx src/app.ts` | Executa o servidor uma vez, sem watch. |
| `dev:watch` | `tsx watch src/app.ts` | Executa com reinício automático a cada alteração de arquivo. |

Dependências de produção: `fastify` (^5.12.5), `@fastify/formbody` (^9.0.0), `@fastify/cookie` (^11.1.2), `fastify-plugin` (^5.0.1), `ioredis` (^5.4.2), `openai` (^4.86.1), `dotenv` (^17.2.3). Dependências de desenvolvimento: `typescript`, `tsx`, `@types/node`.

### 7.2 Variáveis de ambiente (`.env`, ver `.env.example`)

| Variável | Padrão | Descrição |
|---|---|---|
| `PORT` | `3333` | Porta HTTP do servidor. |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Conexão com o Redis. |
| `SESSION_COOKIE_NAME` | `bx_session` | Nome do cookie de sessão. |
| `SESSION_TTL_SECONDS` | `3600` | TTL da sessão no Redis (espelha a expiração do `AUTH_ID`). |
| `SESSION_SECRET` | *(precisa ser trocado)* | Segredo usado para assinar o cookie de sessão. |
| `OPENAI_API_KEY` | *(vazio)* | Key da Kimi API. Sem ela, `/api/chat` responde `503`. |
| `OPENAI_URL` | `https://api.moonshot.ai/v1` | Endpoint compatível com o SDK da OpenAI. |
| `OPENAI_MODEL` | `kimi-k2-0711-preview` | Modelo usado nas chamadas de chat. |
| `BITRIX_MCP_URL` | *(vazio)* | URL do servidor MCP do Bitrix24 (pendente — ver 4.5). |
| `BITRIX_MCP_TOKEN` | *(vazio)* | Credencial do servidor MCP (pendente). |

### 7.3 Pré-requisitos de infraestrutura

- Node.js 18+.
- Um Redis acessível (`docker compose up -d` sobe um Redis 7 local em `redis://127.0.0.1:6379`, via `docker-compose.yml`).
- Uma key válida da Kimi API (Moonshot AI), se o bot de IA for usado.
- Portal Bitrix24 com permissão para adicionar aplicativos locais.
- URL pública em HTTPS apontando para a porta 3333 (o Bitrix24 não aceita `http://localhost` como manipulador) — tipicamente via `ngrok http 3333` ou `npx localtunnel --port 3333`.

### 7.4 Passos de configuração no portal

1. Subir as dependências e o servidor: `docker compose up -d && npm install && npm run dev`.
2. No Bitrix24: **Aplicativos → Desenvolvedores → Aplicativo local** (ou "Recursos do desenvolvedor → Outros → Aplicativo local").
3. Preencher nome, e a **URL do manipulador** como `https://<url-do-tunel>/local-app`.
4. Selecionar os escopos (`CRM`, `Usuário`, `Tarefas`, etc.) necessários para os métodos que serão testados — métodos fora do escopo liberado falharão na chamada REST (inclusive os sugeridos pelo bot).
5. Salvar; o app passa a aparecer no menu **Aplicativos** do portal, onde pode ser aberto (disparando o `POST /local-app` com o contexto do usuário).

### 7.5 Teste fora do Bitrix24

Acessar `http://localhost:3333` diretamente mostra a UI, mas sem `AUTH_ID` (cabeçalho amarelo, qualquer chamada retorna `401`). É possível simular o POST de instalação manualmente:

```bash
curl -X POST http://localhost:3333/local-app \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "AUTH_ID=<token>&DOMAIN=<seu-portal>.bitrix24.com.br" \
  -c cookies.txt -b cookies.txt
```

(usar `-c`/`-b` do curl para persistir o cookie de sessão entre chamadas, já que agora ele é obrigatório para associar o `AUTH_ID` salvo no Redis às chamadas seguintes de `/call` e `/api/chat`.)

O chat pode ser testado diretamente via `curl` também:

```bash
curl -X POST http://localhost:3333/api/chat \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"messages":[{"role":"user","content":"listar os últimos 5 negócios"}]}'
```

## 8. Possíveis evoluções (não implementadas)

- **Integração real com o servidor MCP do Bitrix24** (seção 4.5): definir servidor/transporte/credenciais e implementar `queryMcpKnowledge`.
- **Renovação de token via `refresh_token`** (fluxo OAuth completo do Bitrix24), evitando a necessidade de reabrir o app a cada expiração do `AUTH_ID`.
- **Persistir o histórico do chat** (ex.: também no Redis, por sessão), permitindo retomar a conversa após recarregar a página, e dar alguma auditoria sobre o que o bot sugeriu/executou.
- **Endurecer a classificação de métodos "somente leitura"** usada pelo bot: hoje é uma regex simples (seção 6); poderia evoluir para uma lista curada por módulo ou uma consulta ao catálogo real de métodos (via MCP) com metadados de "somente leitura" explícitos.
- **Servir os estáticos via `@fastify/static`** com cache adequado (atualmente `Cache-Control: no-store` em todas as respostas, aceitável em desenvolvimento mas não ideal em produção).
- **Adicionar HTTPS nativo ao servidor** (hoje delegado inteiramente ao túnel externo).
- **Rate limiting** na rota `/api/chat` (chamadas a uma API de IA paga por token; hoje não há nenhum limite de uso por sessão/usuário).

---
*Documento técnico gerado por análise automatizada do código-fonte, com atualização manual acompanhando a implementação de Redis, bot de IA (Kimi API) e widget de chat.*
