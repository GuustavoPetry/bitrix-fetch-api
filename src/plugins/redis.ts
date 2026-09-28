import fp from "fastify-plugin";
import Redis from "ioredis";
import { env } from "../env";

declare module "fastify" {
  interface FastifyInstance {
    redis: Redis;
  }
}

export default fp(async (app) => {
  // maxRetriesPerRequest baixo: se o Redis estiver fora do ar, cada comando
  // falha rápido (em vez do padrão de até 20 tentativas por comando, o que
  // deixaria as requisições penduradas por vários segundos). A conexão em si
  // continua tentando reconectar em segundo plano via retryStrategy.
  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    retryStrategy(times) {
      return Math.min(times * 200, 2000);
    },
  });

  redis.on("error", (err) => {
    app.log.error({ err }, "[redis] erro de conexão");
  });

  app.decorate("redis", redis);

  app.addHook("onClose", async () => {
    await redis.quit();
  });
});
