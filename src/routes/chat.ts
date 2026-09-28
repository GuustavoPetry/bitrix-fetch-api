import type { FastifyInstance } from "fastify";
import { env } from "../env";
import { getBitrixKnowledgeContext } from "../services/bitrixKnowledge";
import { isReadOnlyMethod } from "../services/bitrixClient";
import { BITRIX_TOOLS, buildSystemPrompt, sanitizeChatMessages } from "../services/chatAgent";

// Rota do agente de IA (Kimi API). Fluxo:
//   1. Recebe o histórico da conversa do widget de chat.
//   2. Pede ao modelo (com tool calling) para decidir method + params.
//   3. NÃO executa o método aqui — devolve method/params para o frontend,
//      que preenche os campos da UI principal e:
//        - se for método de leitura, chama /call automaticamente;
//        - se for método de escrita/exclusão, só chama depois que o usuário
//          confirmar clicando no botão exibido no chat.
//   A execução real do Bitrix24 acontece sempre pela rota /call já existente
//   (src/services/bitrixClient.ts) — o bot nunca chama o Bitrix24 direto.
export default async function chatRoute(app: FastifyInstance) {
  app.post<{ Body: { messages?: unknown } }>("/api/chat", async (req, reply) => {
    if (!env.OPENAI_API_KEY) {
      return reply
        .code(503)
        .send({ error: "Bot de IA não configurado (defina OPENAI_API_KEY no .env)." });
    }

    const messages = sanitizeChatMessages(req.body?.messages);
    const knowledge = await getBitrixKnowledgeContext();

    let completion;
    try {
      completion = await app.openai.chat.completions.create({
        model: env.OPENAI_MODEL,
        messages: [buildSystemPrompt(knowledge), ...messages],
        tools: BITRIX_TOOLS,
        tool_choice: "auto",
      });
    } catch (err) {
      app.log.error({ err }, "[chat] erro ao chamar a Kimi API");
      return reply.code(502).send({ error: "Falha ao consultar o assistente de IA." });
    }

    const choice = completion.choices[0]?.message;

    if (!choice) {
      return reply.code(502).send({ error: "Sem resposta do assistente de IA." });
    }

    const toolCall = choice.tool_calls?.find(
      (tc) => tc.type === "function" && tc.function.name === "call_bitrix_method"
    );

    if (!toolCall) {
      // Resposta puramente conversacional (inclusive a recusa educada para
      // perguntas fora do escopo da API do Bitrix24).
      return { reply: choice.content ?? "", method: null, params: null, requiresConfirmation: false };
    }

    let args: { method?: string; params?: unknown } = {};
    try {
      args = JSON.parse(toolCall.function.arguments || "{}");
    } catch {
      // payload malformado do modelo: cai no tratamento de método inválido abaixo
    }

    const method = (args.method ?? "").trim();
    const isValidMethod = /^[a-z0-9_]+(\.[a-z0-9_]+)+$/i.test(method);

    if (!isValidMethod) {
      return {
        reply:
          choice.content ||
          "Não consegui identificar um método REST válido do Bitrix24 para o que você pediu. Pode detalhar melhor o que você quer fazer?",
        method: null,
        params: null,
        requiresConfirmation: false,
      };
    }

    return {
      reply: choice.content || `Preparei a chamada para **${method}**. Confira os campos e envie.`,
      method,
      params: args.params ?? null,
      requiresConfirmation: !isReadOnlyMethod(method),
    };
  });
}
