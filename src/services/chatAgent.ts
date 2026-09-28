import type OpenAI from "openai";

// Única tool exposta ao modelo: ele decide o método + payload, mas quem
// executa de fato (via rota /call) é sempre o frontend (para leitura,
// automaticamente; para escrita/exclusão, só após confirmação do usuário).
export const BITRIX_TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "call_bitrix_method",
      description:
        "Define o método REST do Bitrix24 e o payload (params) a ser executado através do proxy interno /call, usando a sessão autenticada do usuário atual.",
      parameters: {
        type: "object",
        properties: {
          method: {
            type: "string",
            description:
              "Nome do método REST do Bitrix24, no formato modulo.entidade.acao (ex.: crm.deal.list).",
          },
          params: {
            type: "object",
            description:
              "Corpo (payload) da chamada, no formato aceito pelo método. Omita quando o método não precisar de parâmetros.",
          },
        },
        required: ["method"],
      },
    },
  },
];

export function buildSystemPrompt(knowledge: string): OpenAI.Chat.ChatCompletionMessageParam {
  return {
    role: "system",
    content: `Você é o "Bitrix Copilot", assistente especializado EXCLUSIVAMENTE em ajudar a montar e executar métodos da REST API do Bitrix24 dentro deste console de testes.

Seu trabalho, a cada mensagem do usuário:
1. Entender o que ele quer fazer no Bitrix24.
2. Decidir qual método REST do Bitrix24 deve ser usado.
3. Montar o payload (params) em JSON no formato aceito por esse método.
4. Chamar a tool "call_bitrix_method" com o método e os params montados.

Regras importantes:
- Se não tiver certeza do método ou dos parâmetros corretos, pergunte ao usuário em vez de inventar nomes de métodos ou campos que não existem.
- Escreva o texto da resposta (fora da tool) de forma breve, explicando o que você vai fazer.
- Quem executa a chamada de fato é o próprio console (via /call) — nunca diga que "já executou" algo sozinho.
- Se o usuário pedir qualquer coisa que NÃO seja sobre montar/executar métodos da REST API do Bitrix24 (conversa geral, outros assuntos, outras APIs, código não relacionado, etc.), responda de forma educada e muito breve que você só responde perguntas relacionadas à API do Bitrix24, e não continue esse outro assunto.

Referência de métodos conhecidos (pode não ser exaustiva; prefira sempre métodos documentados oficialmente):
${knowledge}`,
  };
}

export interface SanitizedChatMessage {
  role: "user" | "assistant";
  content: string;
}

// Sanitiza o histórico vindo do frontend: só aceita role user/assistant com
// conteúdo string, e limita o tamanho do histórico enviado ao modelo (custo).
export function sanitizeChatMessages(input: unknown): SanitizedChatMessage[] {
  if (!Array.isArray(input)) return [];

  return input
    .filter(
      (m): m is { role: string; content: string } =>
        Boolean(m) &&
        typeof m === "object" &&
        typeof (m as Record<string, unknown>).content === "string" &&
        ((m as Record<string, unknown>).role === "user" || (m as Record<string, unknown>).role === "assistant")
    )
    .slice(-20)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
}
