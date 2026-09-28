import type { FastifyInstance } from "fastify";
import { getBitrixSession } from "./bitrixSession";

export interface BitrixCallResult {
  // Status "lógico" (o HTTP devolvido pelo próprio Bitrix24, ou um código de
  // validação local como 400/401/502) — é o que a UI exibe no badge.
  status: number;
  data: unknown;
  // Status HTTP que a resposta do Fastify deve usar. Mantém o mesmo contrato
  // do endpoint /call original: erros de validação usam o HTTP real (400/401/502),
  // mas uma chamada bem-sucedida ao Bitrix24 sempre responde HTTP 200 no
  // wrapper, com o status real do Bitrix embutido em `status`.
  httpStatus?: number;
}

// Métodos considerados "somente leitura": o bot de IA pode chamá-los de forma
// automática. Qualquer outro método (add/update/delete/etc.) é tratado como
// escrita/exclusão e exige confirmação explícita do usuário antes de ir para
// esta função a partir da rota de chat.
const READ_ONLY_PATTERN = /\.(list|get|fields|current|count|ping)(\.|$)/i;

export function isReadOnlyMethod(method: string): boolean {
  return READ_ONLY_PATTERN.test(method.trim().toLowerCase());
}

// Ponto único de execução de métodos REST do Bitrix24. Usado tanto pela rota
// /call (chamada manual pela UI) quanto, indiretamente, pelo fluxo do bot de
// IA — que nunca chama o Bitrix24 diretamente, apenas decide method/params e
// deixa a execução real acontecer por aqui.
export async function callBitrixMethod(
  app: FastifyInstance,
  sessionId: string,
  rawMethod: string,
  params?: unknown
): Promise<BitrixCallResult> {
  const method = (rawMethod ?? "").trim().replace(/^\/+/, "");

  if (!method) {
    return { status: 400, data: { error: "Informe o método REST." }, httpStatus: 400 };
  }

  const session = await getBitrixSession(app, sessionId);

  if (!session?.authId) {
    return {
      status: 401,
      data: { error: "AUTH_ID não disponível. Abra o app dentro do Bitrix24." },
      httpStatus: 401,
    };
  }

  const url = `https://${session.domain}/rest/${method}?auth=${session.authId}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      ...(params !== undefined
        ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(params) }
        : {}),
    });

    const raw = await response.text();
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }

    return { status: response.status, data, httpStatus: 200 };
  } catch (err) {
    return {
      status: 502,
      data: { error: err instanceof Error ? err.message : "Falha ao chamar o Bitrix24" },
      httpStatus: 502,
    };
  }
}
