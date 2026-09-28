import { isMcpConfigured, queryMcpKnowledge } from "./bitrixMcp";

// Catálogo estático e resumido de métodos comuns da REST API do Bitrix24.
// Serve como contexto de referência para o bot de IA. NÃO é exaustivo —
// o próprio prompt do bot instrui o modelo a perguntar ao usuário em vez de
// inventar métodos/campos quando não tiver certeza.
export const BITRIX_KNOWLEDGE_CATALOG = `
Catálogo resumido de módulos e métodos comuns da REST API do Bitrix24 (não exaustivo,
sempre POST). Quando não tiver certeza do nome exato do método ou dos parâmetros aceitos,
pergunte ao usuário em vez de inventar.

CRM:
- crm.deal.list / crm.deal.get / crm.deal.add / crm.deal.update / crm.deal.delete / crm.deal.fields
- crm.lead.list / crm.lead.get / crm.lead.add / crm.lead.update / crm.lead.delete / crm.lead.fields
- crm.contact.list / crm.contact.get / crm.contact.add / crm.contact.update / crm.contact.fields
- crm.company.list / crm.company.get / crm.company.add / crm.company.fields

Usuários:
- user.current (dados do usuário logado)
- user.get, user.search

Tarefas:
- tasks.task.list, tasks.task.get, tasks.task.add, tasks.task.update, tasks.task.delete

Disco (arquivos):
- disk.storage.getlist, disk.folder.getchildren, disk.file.get

Calendário:
- calendar.event.get, calendar.event.add

Mensageria interna (im):
- im.message.add, im.notify

Convenção geral: todo método aceita POST, retorna { result, time } em sucesso ou
{ error, error_description } em falha, e respeita os escopos liberados na instalação do app.
`.trim();

// Ponto único de montagem do "conhecimento" passado ao bot no prompt de
// sistema. Hoje retorna só o catálogo estático acima; quando o servidor MCP
// do Bitrix24 (src/services/bitrixMcp.ts) estiver configurado, o resultado
// da consulta MCP é anexado como contexto adicional (nunca substitui a regra
// de que a execução real sempre passa pela rota /call).
export async function getBitrixKnowledgeContext(): Promise<string> {
  if (!isMcpConfigured()) {
    return BITRIX_KNOWLEDGE_CATALOG;
  }

  const mcpContext = await queryMcpKnowledge("catálogo geral de métodos");

  if (!mcpContext) {
    return BITRIX_KNOWLEDGE_CATALOG;
  }

  return `${BITRIX_KNOWLEDGE_CATALOG}\n\nContexto adicional obtido via MCP:\n${mcpContext}`;
}
