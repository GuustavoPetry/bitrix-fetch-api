import fastify from "fastify";
import fastifyFormbody from "@fastify/formbody";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { env } from "./env";
import redisPlugin from "./plugins/redis";
import sessionPlugin from "./plugins/session";
import openaiPlugin from "./plugins/openai";
import chatRoute from "./routes/chat";
import { saveBitrixSession, getBitrixSession } from "./services/bitrixSession";
import { callBitrixMethod } from "./services/bitrixClient";

const app = fastify({ logger: true });

const PUBLIC_DIR = path.join(process.cwd(), "public");

async function sendAppHtml(reply: import("fastify").FastifyReply) {
  const html = await readFile(path.join(PUBLIC_DIR, "index.html"), "utf-8");
  return reply.header("Cache-Control", "no-store").type("text/html").send(html);
}

async function bootstrap() {
  await app.register(fastifyFormbody);
  await app.register(redisPlugin);
  await app.register(sessionPlugin);
  await app.register(openaiPlugin);
  await app.register(chatRoute);

  // Rota de instalação/abertura: o Bitrix24 faz POST com AUTH_ID, DOMAIN, etc.
  // O contexto agora é salvo no Redis, associado à sessão (cookie) do usuário
  // que abriu o app — não é mais uma variável global compartilhada.
  app.post<{ Body: { AUTH_ID?: string; DOMAIN?: string } }>("/local-app", async (req, reply) => {
    await saveBitrixSession(app, req.bitrixSessionId, {
      ...(req.body.AUTH_ID !== undefined ? { authId: req.body.AUTH_ID } : {}),
      ...(req.body.DOMAIN !== undefined ? { domain: req.body.DOMAIN } : {}),
    });

    app.log.info({ hasAuth: Boolean(req.body.AUTH_ID) }, "[bitrix] contexto recebido");

    return sendAppHtml(reply);
  });

  // Mesma página via GET para testes locais no navegador
  app.get("/", async (_req, reply) => sendAppHtml(reply));

  // Arquivos estáticos da UI
  app.get("/app.js", async (_req, reply) =>
    reply
      .header("Cache-Control", "no-store")
      .type("text/javascript")
      .send(await readFile(path.join(PUBLIC_DIR, "app.js"), "utf-8"))
  );
  app.get("/chat.js", async (_req, reply) =>
    reply
      .header("Cache-Control", "no-store")
      .type("text/javascript")
      .send(await readFile(path.join(PUBLIC_DIR, "chat.js"), "utf-8"))
  );
  app.get("/style.css", async (_req, reply) =>
    reply
      .header("Cache-Control", "no-store")
      .type("text/css")
      .send(await readFile(path.join(PUBLIC_DIR, "style.css"), "utf-8"))
  );

  // Contexto atual (para a UI exibir status) — agora lido do Redis, por sessão.
  app.get("/context", async (req) => {
    const session = await getBitrixSession(app, req.bitrixSessionId);
    return {
      domain: session?.domain ?? "tiqtech.bitrix24.com.br",
      authenticated: Boolean(session?.authId),
    };
  });

  // Proxy REST: toda chamada sai como POST para https://DOMAIN/rest/<method>?auth=AUTH_ID
  app.post<{ Body: { method?: string; params?: unknown } }>("/call", async (req, reply) => {
    const result = await callBitrixMethod(app, req.bitrixSessionId, req.body?.method ?? "", req.body?.params);
    return reply.code(result.httpStatus ?? 200).send({ status: result.status, data: result.data });
  });

  await app.listen({ host: "0.0.0.0", port: env.PORT });
  console.log(`HTTP Server Running on http://localhost:${env.PORT}`);
}

bootstrap().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
