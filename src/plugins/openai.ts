import fp from "fastify-plugin";
import OpenAI from "openai";
import { env } from "../env";

declare module "fastify" {
  interface FastifyInstance {
    openai: OpenAI;
  }
}

// Segue o mesmo padrão de plugin fastify-plugin já usado no projeto: decora
// `app.openai` com um client do SDK da OpenAI apontando para o endpoint da
// Kimi API (compatível com o formato OpenAI, incluindo tool/function calling).
export default fp(async (app) => {
  const openai = new OpenAI({
    apiKey: env.OPENAI_API_KEY,
    baseURL: env.OPENAI_URL,
  });

  app.decorate("openai", openai);
});
