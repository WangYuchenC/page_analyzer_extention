import { ChatOpenAI } from '@langchain/openai';
import { DynamicTool } from '@langchain/core/tools';
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from '@langchain/core/messages';
import type { BaseMessage } from '@langchain/core/messages';
import type { ChatMessage } from '~types';
import { MessageType } from '~types';
import { sendToContentScript } from './messaging';
import { debugLog, errorLog, warnLog, infoLog } from './logger';

// #region Follow-up streaming (bypasses LangChain message serialization
// to handle reasoning_content pass-back for DeepSeek thinking mode)

function msgToApi(msg: BaseMessage): Record<string, unknown> {
  const type = msg._getType();
  debugLog('msgToApi', 'Converting message type:', type);

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
      debugLog('msgToApi', `Added ${ai.tool_calls.length} tool_calls to message`);
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
  infoLog('streamFollowUp', 'Starting follow-up stream', { baseUrl, model, historyLength: history.length, toolMsgsCount: toolMsgs.length });

  const apiMessages: Record<string, unknown>[] = [];
  for (const m of history) apiMessages.push(msgToApi(m));
  // Note: assistantMsg is already included in history, don't add it again
  for (const m of toolMsgs) apiMessages.push(msgToApi(m));

  debugLog('streamFollowUp', 'API messages prepared:', apiMessages.length, 'messages');
  debugLog('streamFollowUp', 'First message:', JSON.stringify(apiMessages[0], null, 2));
  debugLog('streamFollowUp', 'Last message:', JSON.stringify(apiMessages[apiMessages.length - 1], null, 2));

  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const endpoint = normalizedBase.endsWith('/chat/completions')
    ? normalizedBase
    : normalizedBase + '/chat/completions';

  infoLog('streamFollowUp', 'Sending request to:', endpoint);

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages: apiMessages, stream: true }),
      signal,
    });
    infoLog('streamFollowUp', 'Response received, status:', res.status);
  } catch (fetchError) {
    errorLog('streamFollowUp', 'Fetch failed:', fetchError);
    throw fetchError;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    errorLog('streamFollowUp', 'API error response:', res.status, body);
    throw new Error(`API error: ${res.status} ${body}`);
  }

  if (!res.body) {
    errorLog('streamFollowUp', 'Response body is empty');
    throw new Error('Response body is empty');
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let chunkCount = 0;
  let totalContent = '';

  infoLog('streamFollowUp', 'Starting to read stream...');

  while (true) {
    let readResult: { done: boolean; value?: Uint8Array };
    try {
      readResult = await reader.read();
    } catch (readError) {
      errorLog('streamFollowUp', 'Error reading stream:', readError);
      throw readError;
    }

    const { done, value } = readResult;
    if (done) {
      infoLog('streamFollowUp', 'Stream complete, total chunks:', chunkCount, 'total content length:', totalContent.length);
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') {
        infoLog('streamFollowUp', 'Received [DONE] signal');
        return;
      }
      try {
        const parsed = JSON.parse(data);
        chunkCount++;

        // Handle both standard OpenAI format and DeepSeek format
        const choice = parsed.choices?.[0];
        if (!choice) {
          debugLog('streamFollowUp', 'No choice in chunk', parsed);
          continue;
        }
        const delta = choice.delta;
        if (!delta) {
          debugLog('streamFollowUp', 'No delta in choice', choice);
          continue;
        }

        // Handle both content and reasoning_content (for DeepSeek thinking mode)
        const content = delta.content;
        const reasoningContent = delta.reasoning_content;

        if (content) {
          totalContent += content;
          yield content;
        }
        if (reasoningContent) {
          totalContent += reasoningContent;
          yield reasoningContent;
        }

        // Handle finish_reason to detect early stopping
        if (choice.finish_reason) {
          if (choice.finish_reason !== 'stop') {
            warnLog('streamFollowUp', 'Stream finished with reason:', choice.finish_reason);
          } else {
            infoLog('streamFollowUp', 'Stream finished normally (stop)');
          }
        }
      } catch (e) {
        // Log parse errors for debugging
        warnLog('streamFollowUp', 'Failed to parse SSE data:', data, e);
      }
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
  debugLog('createChromeTools', 'Creating tools for tab:', tabId);

  return TOOL_CONFIGS.map(
    (config) =>
      new DynamicTool({
        name: config.name,
        description: config.description,
        func: async (input: string) => {
          const messageType = TOOL_TO_MESSAGE_TYPE[config.name];
          debugLog('Tool:' + config.name, 'Called with input:', input, 'type:', typeof input);

          try {
            // Handle both string input and object input (LangChain may pass either)
            let args: Record<string, unknown>;
            if (!input) {
              args = {};
              debugLog('Tool:' + config.name, 'Empty input, using empty args');
            } else if (typeof input === 'string') {
              try {
                args = JSON.parse(input);
                debugLog('Tool:' + config.name, 'Parsed string input:', args);
              } catch (parseError) {
                errorLog('Tool:' + config.name, 'Failed to parse input:', input, parseError);
                throw parseError;
              }
            } else if (typeof input === 'object') {
              args = input as Record<string, unknown>;
              debugLog('Tool:' + config.name, 'Using object input directly:', args);
            } else {
              args = {};
              warnLog('Tool:' + config.name, 'Unexpected input type:', typeof input);
            }

            infoLog('Tool:' + config.name, 'Executing with args:', args);
            const result = await sendToContentScript(tabId, messageType, args);
            infoLog('Tool:' + config.name, 'Execution result:', result);
            return JSON.stringify(result, null, 2);
          } catch (error) {
            errorLog('Tool:' + config.name, 'Execution error:', error);
            return JSON.stringify({ error: (error as Error).message });
          }
        },
      })
  );
}

export function createChatModel(apiKey: string, baseUrl: string, model: string, temperature = 0): ChatOpenAI {
  infoLog('createChatModel', 'Creating chat model:', { baseUrl, model, temperature });
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
  debugLog('toLangChainMessages', 'Converting', messages.length, 'messages');

  return messages.map((msg, index) => {
    debugLog('toLangChainMessages', `Message ${index}:`, msg.role, msg.content?.slice(0, 50));

    switch (msg.role) {
      case 'user':
        return new HumanMessage(msg.content);
      case 'assistant': {
        if (msg.tool_calls?.length) {
          debugLog('toLangChainMessages', `Message ${index} has ${msg.tool_calls.length} tool_calls`);
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
  infoLog('executeToolCalls', 'Executing', toolCalls.length, 'tool calls');

  return Promise.all(
    toolCalls.map(async (tc, index) => {
      debugLog('executeToolCalls', `Tool call ${index}:`, tc.name, tc.id);

      const messageType = TOOL_TO_MESSAGE_TYPE[tc.name];
      if (!messageType) {
        errorLog('executeToolCalls', 'Unknown tool:', tc.name);
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

        debugLog('executeToolCalls', `Executing ${tc.name} with args:`, args);
        const result = await sendToContentScript(tabId, messageType, args);
        debugLog('executeToolCalls', `${tc.name} result:`, result);

        return new ToolMessage({
          content: JSON.stringify(result, null, 2),
          tool_call_id: tc.id!,
        });
      } catch (error) {
        errorLog('executeToolCalls', `Error executing ${tc.name}:`, error);
        return new ToolMessage({
          content: JSON.stringify({ error: (error as Error).message }),
          tool_call_id: tc.id!,
        });
      }
    })
  );
}
