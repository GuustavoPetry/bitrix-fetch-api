import "dotenv/config";

export const env = {
  PORT: Number(process.env.PORT ?? 3333),

  // Redis: guarda o contexto (AUTH_ID/DOMAIN) de cada sessão do Bitrix24.
  REDIS_URL: process.env.REDIS_URL ?? "redis://127.0.0.1:6379",

  // Sessão por usuário (cookie assinado). Isso substitui a antiga variável
  // global única em memória: cada aba/usuário que abre o app ganha seu
  // próprio AUTH_ID guardado no Redis, sob uma chave própria.
  SESSION_COOKIE_NAME: process.env.SESSION_COOKIE_NAME ?? "bx_session",
  SESSION_TTL_SECONDS: Number(process.env.SESSION_TTL_SECONDS ?? 3600),
  SESSION_SECRET: process.env.SESSION_SECRET ?? "troque-este-segredo-em-producao",

  // Kimi API (endpoint compatível com o SDK da OpenAI).
  OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? "",
  OPENAI_URL: process.env.OPENAI_URL ?? "https://api.moonshot.ai/v1",
  OPENAI_MODEL: process.env.OPENAI_MODEL ?? "kimi-k2-0711-preview",

  // Servidor MCP do Bitrix24 (opcional, ainda não configurado). Enquanto
  // BITRIX_MCP_URL estiver vazio, o bot usa apenas o catálogo estático em
  // src/services/bitrixKnowledge.ts como referência de métodos.
  BITRIX_MCP_URL: process.env.BITRIX_MCP_URL ?? "",
  BITRIX_MCP_TOKEN: process.env.BITRIX_MCP_TOKEN ?? "",
};
