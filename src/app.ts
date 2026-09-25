import fastify from "fastify";
import fastifyFormbody from "@fastify/formbody";
import { readFile } from "node:fs/promises";
import path from "node:path";

// Contexto injetado pelo Bitrix24 na instalação/abertura do app local
let AUTH_ID = "";
let DOMAIN = "tiqtech.bitrix24.com.br";

const app = fastify();

app.register(fastifyFormbody);

const PUBLIC_DIR = path.join(process.cwd(), "public");

async function sendAppHtml(reply: import("fastify").FastifyReply) {
  const html = await readFile(path.join(PUBLIC_DIR, "index.html"), "utf-8");
  return reply.type("text/html").send(html);
}

// Rota de instalação/abertura: o Bitrix24 faz POST com AUTH_ID, DOMAIN, etc.
app.post<{ Body: { AUTH_ID?: string; DOMAIN?: string } }>("/local-app", async (req, reply) => {
  AUTH_ID = req.body.AUTH_ID ?? AUTH_ID;
  DOMAIN = req.body.DOMAIN ?? DOMAIN;

  console.log("[bitrix] contexto recebido:", { DOMAIN, hasAuth: Boolean(AUTH_ID) });

  return sendAppHtml(reply);
});

// Mesma página via GET para testes locais no navegador
app.get("/", async (_req, reply) => sendAppHtml(reply));

// Arquivos estáticos da UI
app.get("/app.js", async (_req, reply) =>
  reply.type("text/javascript").send(await readFile(path.join(PUBLIC_DIR, "app.js"), "utf-8"))
);
app.get("/style.css", async (_req, reply) =>
  reply.type("text/css").send(await readFile(path.join(PUBLIC_DIR, "style.css"), "utf-8"))
);

// Contexto atual (para a UI exibir status)
app.get("/context", async () => ({
  domain: DOMAIN,
  authenticated: Boolean(AUTH_ID),
}));

// Proxy REST: toda chamada sai como POST para https://DOMAIN/rest/<method>?auth=AUTH_ID
app.post<{ Body: { method?: string; params?: unknown } }>("/call", async (req, reply) => {
  const method = (req.body?.method ?? "").trim().replace(/^\/+/, "");

  if (!method) {
    return reply.code(400).send({ status: 400, data: { error: "Informe o método REST." } });
  }
  if (!AUTH_ID) {
    return reply.code(401).send({
      status: 401,
      data: { error: "AUTH_ID não disponível. Abra o app dentro do Bitrix24." },
    });
  }

  const url = `https://${DOMAIN}/rest/${method}?auth=${AUTH_ID}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body?.params ?? {}),
    });

    const data = await response.json().catch(() => null);

    return { status: response.status, data };
  } catch (err) {
    return reply.code(502).send({
      status: 502,
      data: { error: err instanceof Error ? err.message : "Falha ao chamar o Bitrix24" },
    });
  }
});

app.listen({ host: "0.0.0.0", port: 3333 }).then(() => {
  console.log("HTTP Server Running on http://localhost:3333");
});
