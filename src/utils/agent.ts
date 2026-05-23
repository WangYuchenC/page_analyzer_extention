import { ChatOpenAI } from '@langchain/openai';
import { DynamicTool } from '@langchain/core/tools';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import type { ChatMessage } from '~types';
import { MessageType } from '~types';
import { sendToContentScript } from './messaging';

// #region Follow-up streaming (bypasses LangChain message serialization
// to handle reasoning_content pass-back for DeepSeek thinking mode)

function msgToApi(msg: BaseMessage): Record<string, unknown> {
  const type = msg._getType();
  if (type === 'system') return { role: 'system', content: msg.content };
  if (type === 'human') {
    if (typeof msg.content !== 'string' && Array.isArray(msg.content)) {
      return { role: 'user', content: msg.content };
    }
    return { role: 'user', content: msg.content };
  }
  if (type === 'ai') {
    const ai = msg as AIMessage;
    const entry: Record<string, unknown> = { role: 'assistant', content: ai.content || null };
    if (ai.tool_calls?.length) {
      entry.tool_calls = ai.tool_calls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: {
          name: tc.name,
          arguments: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args),
        },
      }));
    }
    const rc = ai.additional_kwargs?.reasoning_content;
    if (rc) entry.reasoning_content = rc;
    return entry;
  }
  if (type === 'tool') {
    return { role: 'tool', tool_call_id: (msg as ToolMessage).tool_call_id, content: msg.content };
  }
  return { role: 'user', content: msg.content };
}

/**
 * Streaming follow-up call with proper reasoning_content pass-back.
 * Bypasses LangChain's message serialization which drops
 * additional_kwargs.reasoning_content — required by DeepSeek thinking mode.
 */
export async function* streamFollowUp(
  apiKey: string,
  baseUrl: string,
  model: string,
  history: BaseMessage[],
  assistantMsg: AIMessage,
  toolMsgs: ToolMessage[],
  signal: AbortSignal
): AsyncGenerator<string> {
  const apiMessages: Record<string, unknown>[] = [];
  for (const m of history) apiMessages.push(msgToApi(m));
  apiMessages.push(msgToApi(assistantMsg));
  for (const m of toolMsgs) apiMessages.push(msgToApi(m));

  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const endpoint = normalizedBase.endsWith('/chat/completions')
    ? normalizedBase
    : normalizedBase + '/chat/completions';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, messages: apiMessages, stream: true }),
    signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`API error: ${res.status} ${body}`);
  }

  if (!res.body) {
    throw new Error('Response body is empty');
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) yield content;
      } catch { /* skip */ }
    }
  }
}

// #endregion

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
            const result = await sendToContentScript(tabId, messageType, args);
            return JSON.stringify(result, null, 2);
          } catch (error) {
            return JSON.stringify({ error: (error as Error).message });
          }
        },
      })
  );
}

export function createChatModel(apiKey: string, baseUrl: string, model: string, temperature = 0): ChatOpenAI {
  return new ChatOpenAI({
    apiKey: apiKey,
    configuration: { baseURL: baseUrl },
    model,
    temperature,
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
        // tc.args is Record<string, any> from LangChain ToolCall (parsed object),
        // but may be a JSON string when reconstructed from stored ChatMessage history
        const args = tc.args
          ? (typeof tc.args === 'string' ? JSON.parse(tc.args) : tc.args)
          : {};
        const result = await sendToContentScript(tabId, messageType, args);
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
