import fp from "fastify-plugin";
import cookie from "@fastify/cookie";
import { randomUUID } from "node:crypto";
import { env } from "../env";

declare module "fastify" {
  interface FastifyRequest {
    // Identificador de sessão único por usuário/navegador, usado como chave
    // no Redis para guardar o AUTH_ID/DOMAIN daquele usuário.
    bitrixSessionId: string;
  }
}

// Cookie assinado de sessão. Necessário para que múltiplos usuários possam
// abrir o app ao mesmo tempo sem que um sobrescreva o contexto do outro
// (limitação do design original, que usava uma única variável global).
//
// Observação: como o app roda dentro de um iframe do Bitrix24 (contexto de
// terceiros), o cookie precisa de SameSite=None + Secure, o que exige HTTPS
// (já garantido pelo túnel ngrok/localtunnel usado no manipulador do app).
// Alguns navegadores com política estrita de cookies de terceiros (ex.:
// Safari ITP) podem bloquear esse cookie mesmo assim — se isso ocorrer na
// prática, a alternativa é migrar para um token de sessão embutido na URL
// ou passado pelo próprio Bitrix24 (ex.: member_id).
export default fp(async (app) => {
  await app.register(cookie, {
    secret: env.SESSION_SECRET,
  });

  app.addHook("onRequest", async (req, reply) => {
    const raw = req.cookies[env.SESSION_COOKIE_NAME];
    const unsigned = raw ? app.unsignCookie(raw) : null;

    let sessionId = unsigned?.valid ? unsigned.value : undefined;

    if (!sessionId) {
      sessionId = randomUUID();
      reply.setCookie(env.SESSION_COOKIE_NAME, sessionId, {
        path: "/",
        httpOnly: true,
        sameSite: "none",
        secure: true,
        signed: true,
        maxAge: env.SESSION_TTL_SECONDS,
      });
    }

    req.bitrixSessionId = sessionId;
  });
});
