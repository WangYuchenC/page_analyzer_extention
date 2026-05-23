import { ChatOpenAI } from '@langchain/openai';
import { DynamicTool } from '@langchain/core/tools';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import type { ChatMessage } from '~types';
import { MessageType } from '~types';

const TOOL_CONFIGS = [
  {
    name: 'query_selector',
    description:
      'Query the page DOM using a CSS selector. Returns text content, HTML, and attributes of matching elements. Input: JSON with "selector" (string, required), "maxResults" (number, optional, default 5, max 20), "includeHtml" (boolean, optional, default false).',
  },
  {
    name: 'search_page',
    description:
      'Search the visible text content of the page for a query. Returns matches with surrounding context. Input: JSON with "query" (string, required), "maxResults" (number, optional, default 10, max 30), "contextChars" (number, optional, default 80).',
  },
  {
    name: 'get_page_info',
    description:
      'Get basic information about the current page: URL, title, meta description, language. Input: empty JSON object {}.',
  },
  {
    name: 'get_selected_element',
    description:
      'Get detailed information about the user\'s currently selected element (tag, XPath, CSS selector, text). Requires the element picker to have been used first. Input: empty JSON object {}.',
  },
];

const TOOL_TO_MESSAGE_TYPE: Record<string, MessageType> = {
  query_selector: MessageType.QUERY_SELECTOR,
  search_page: MessageType.SEARCH_PAGE,
  get_page_info: MessageType.GET_PAGE_INFO,
  get_selected_element: MessageType.GET_SELECTED_ELEMENT,
};

async function sendToTab<T>(tabId: number, type: MessageType, payload: unknown): Promise<T> {
  try {
    return await chrome.tabs.sendMessage(tabId, { type, payload });
  } catch {
    const jsFiles = chrome.runtime.getManifest().content_scripts?.[0]?.js;
    if (jsFiles) {
      await chrome.scripting.executeScript({ target: { tabId }, files: jsFiles });
    }
    return await chrome.tabs.sendMessage(tabId, { type, payload });
  }
}

export function createChromeTools(tabId: number): DynamicTool[] {
  return TOOL_CONFIGS.map(
    (config) =>
      new DynamicTool({
        name: config.name,
        description: config.description,
        func: async (input: string) => {
          const messageType = TOOL_TO_MESSAGE_TYPE[config.name];
          try {
            const args = input ? JSON.parse(input) : {};
            const result = await sendToTab(tabId, messageType, args);
            return JSON.stringify(result, null, 2);
          } catch (error) {
            return JSON.stringify({ error: (error as Error).message });
          }
        },
      })
  );
}

export function createChatModel(apiKey: string, baseUrl: string, model: string): ChatOpenAI {
  return new ChatOpenAI({
    openAIApiKey: apiKey,
    configuration: { baseURL: baseUrl },
    model,
    temperature: 0,
    streaming: true,
  });
}

/**
 * Convert our ChatMessage[] to LangChain BaseMessage[].
 * Used for conversation history.
 */
export function toLangChainMessages(messages: ChatMessage[]): BaseMessage[] {
  return messages.map((msg) => {
    switch (msg.role) {
      case 'user':
        return new HumanMessage(msg.content);
      case 'assistant': {
        if (msg.tool_calls?.length) {
          return new AIMessage({
            content: msg.content || '',
            tool_calls: msg.tool_calls.map((tc) => ({
              id: tc.id,
              type: 'tool_call' as const,
              name: tc.function.name,
              args: tc.function.arguments,
            })),
          });
        }
        return new AIMessage(msg.content);
      }
      case 'tool':
        return new ToolMessage({
          content: msg.content,
          tool_call_id: msg.tool_call_id!,
        });
      case 'system':
        return new SystemMessage(msg.content);
      default:
        return new HumanMessage(msg.content);
    }
  });
}

/**
 * Execute tool calls from an AIMessage and return LangChain ToolMessage results.
 */
export async function executeToolCalls(
  toolCalls: Required<BaseMessage>['tool_calls'],
  tabId: number
): Promise<ToolMessage[]> {
  return Promise.all(
    toolCalls.map(async (tc) => {
      const messageType = TOOL_TO_MESSAGE_TYPE[tc.name];
      if (!messageType) {
        return new ToolMessage({
          content: JSON.stringify({ error: `Unknown tool: ${tc.name}` }),
          tool_call_id: tc.id!,
        });
      }
      try {
        const args = tc.args ? JSON.parse(tc.args) : {};
        const result = await sendToTab(tabId, messageType, args);
        return new ToolMessage({
          content: JSON.stringify(result, null, 2),
          tool_call_id: tc.id!,
        });
      } catch (error) {
        return new ToolMessage({
          content: JSON.stringify({ error: (error as Error).message }),
          tool_call_id: tc.id!,
        });
      }
    })
  );
}
