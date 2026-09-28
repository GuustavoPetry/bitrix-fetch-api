import { env } from "../env";

/**
 * PENDENTE DE CONFIGURAÇÃO — ainda não conectado a um servidor MCP real.
 *
 * Este módulo é o único ponto de integração com o servidor MCP do Bitrix24.
 * Sua função é EXCLUSIVAMENTE consultar documentação/descoberta de métodos
 * para enriquecer o contexto do bot — nunca executar chamadas em nome do
 * usuário. Toda execução real de métodos do Bitrix24 continua acontecendo
 * apenas via src/services/bitrixClient.ts (rota /call), mesmo depois que o
 * MCP estiver configurado.
 *
 * Para ativar de fato, falta definir:
 *   - Qual servidor MCP será usado (nome/pacote/URL);
 *   - Qual transporte ele expõe (stdio, SSE ou HTTP streamable) — o cliente
 *     oficial é o pacote "@modelcontextprotocol/sdk", que ainda não foi
 *     adicionado às dependências do projeto;
 *   - Credenciais de acesso (BITRIX_MCP_URL / BITRIX_MCP_TOKEN no .env).
 */
export function isMcpConfigured(): boolean {
  return Boolean(env.BITRIX_MCP_URL);
}

export async function queryMcpKnowledge(_query: string): Promise<string | null> {
  if (!isMcpConfigured()) {
    return null;
  }

  // TODO: implementar a consulta real assim que tivermos os dados de acesso
  // do servidor MCP do Bitrix24.
  return null;
}
