import type { FastifyInstance } from "fastify";
import { env } from "../env";

export interface BitrixSessionData {
  authId: string;
  domain: string;
}

const DEFAULT_DOMAIN = "tiqtech.bitrix24.com.br";

function redisKey(sessionId: string) {
  return `bitrix:session:${sessionId}`;
}

// Guarda (com merge) o AUTH_ID/DOMAIN da sessão atual no Redis, com TTL igual
// à expiração esperada do AUTH_ID do Bitrix24 (padrão: 1h, via SESSION_TTL_SECONDS).
export async function saveBitrixSession(
  app: FastifyInstance,
  sessionId: string,
  data: Partial<BitrixSessionData>
): Promise<BitrixSessionData> {
  const current = await getBitrixSession(app, sessionId);

  const merged: BitrixSessionData = {
    authId: data.authId ?? current?.authId ?? "",
    domain: data.domain ?? current?.domain ?? DEFAULT_DOMAIN,
  };

  try {
    await app.redis.set(redisKey(sessionId), JSON.stringify(merged), "EX", env.SESSION_TTL_SECONDS);
  } catch (err) {
    app.log.warn({ err }, "[bitrix-session] não foi possível salvar no Redis");
  }

  return merged;
}

export async function getBitrixSession(
  app: FastifyInstance,
  sessionId: string
): Promise<BitrixSessionData | null> {
  let raw: string | null;
  try {
    raw = await app.redis.get(redisKey(sessionId));
  } catch (err) {
    app.log.warn({ err }, "[bitrix-session] não foi possível ler do Redis");
    return null;
  }

  if (!raw) return null;

  try {
    return JSON.parse(raw) as BitrixSessionData;
  } catch {
    return null;
  }
}
