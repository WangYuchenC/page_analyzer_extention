import { ChatOpenAI } from "@langchain/openai";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { DynamicTool } from "@langchain/core/tools";
import { debugLog, errorLog, infoLog, warnLog } from "./logger";
import { MessageType } from "../types";
import { sendToContentScript } from "./messaging";
import type { ChatMessage } from "../types";

export function createChromeTools(tabId: number) {
  debugLog("createChromeTools", "Creating tools for tab:", tabId);

  const querySelectorTool = new DynamicTool({
    name: "query_selector",
    description:
      "Query the page DOM using a CSS selector. Returns text content, HTML, and attributes of matching elements. Input: JSON with \"selector\" (string, required), \"maxResults\" (number, optional, default 5, max 20), \"includeHtml\" (boolean, optional, default false).",
    func: async (input: string) => {
      debugLog("Tool:query_selector", "Executing with input:", input);
      try {
        const args = typeof input === "string" ? (input ? JSON.parse(input) : {}) : input;
        const result = await sendToContentScript(tabId, {
          type: MessageType.QUERY_SELECTOR,
          payload: args,
        });
        return JSON.stringify(result, null, 2);
      } catch (error) {
        errorLog("Tool:query_selector", "Error:", error);
        return JSON.stringify({ error: (error as Error).message });
      }
    },
  });

  const searchPageTool = new DynamicTool({
    name: "search_page",
    description:
      "Search the visible text content of the page for a query. Returns matches with surrounding context. Input: JSON with \"query\" (string, required), \"maxResults\" (number, optional, default 10, max 30), \"contextChars\" (number, optional, default 80).",
    func: async (input: string) => {
      debugLog("Tool:search_page", "Executing with input:", input);
      try {
        const args = typeof input === "string" ? (input ? JSON.parse(input) : {}) : input;
        const result = await sendToContentScript(tabId, {
          type: MessageType.SEARCH_PAGE,
          payload: args,
        });
        return JSON.stringify(result, null, 2);
      } catch (error) {
        errorLog("Tool:search_page", "Error:", error);
        return JSON.stringify({ error: (error as Error).message });
      }
    },
  });

  const getPageInfoTool = new DynamicTool({
    name: "get_page_info",
    description:
      "Get basic information about the current page: URL, title, meta description, language. Input: empty JSON object {}.",
    func: async () => {
      debugLog("Tool:get_page_info", "Executing");
      try {
        const result = await sendToContentScript(tabId, {
          type: MessageType.GET_PAGE_INFO,
          payload: {},
        });
        return JSON.stringify(result, null, 2);
      } catch (error) {
        errorLog("Tool:get_page_info", "Error:", error);
        return JSON.stringify({ error: (error as Error).message });
      }
    },
  });

  const getSelectedElementTool = new DynamicTool({
    name: "get_selected_element",
    description:
      "Get detailed information about the user's currently selected element (tag, XPath, CSS selector, text). Requires the element picker to have been used first. Input: empty JSON object {}.",
    func: async () => {
      debugLog("Tool:get_selected_element", "Executing");
      try {
        const result = await sendToContentScript(tabId, {
          type: MessageType.GET_SELECTED_ELEMENT,
          payload: {},
        });
        return JSON.stringify(result, null, 2);
      } catch (error) {
        errorLog("Tool:get_selected_element", "Error:", error);
        return JSON.stringify({ error: (error as Error).message });
      }
    },
  });

  const clickElementTool = new DynamicTool({
    name: "click_element",
    description:
      "Click on an element on the page. Input: JSON with \"selector\" (CSS selector, required), \"waitBefore\" (ms, optional), \"waitAfter\" (ms, optional, default 500).",
    func: async (input: string) => {
      debugLog("Tool:click_element", "Executing with input:", input);
      try {
        const args = typeof input === "string" ? (input ? JSON.parse(input) : {}) : input;
        const result = await sendToContentScript(tabId, {
          type: MessageType.CLICK_ELEMENT,
          payload: args,
        });
        return JSON.stringify(result, null, 2);
      } catch (error) {
        errorLog("Tool:click_element", "Error:", error);
        return JSON.stringify({ error: (error as Error).message });
      }
    },
  });

  const inputTextTool = new DynamicTool({
    name: "input_text",
    description:
      "Input text into a form field. Input: JSON with \"selector\" (CSS selector, required), \"text\" (string to input, required), \"submit\" (boolean, optional, default false).",
    func: async (input: string) => {
      debugLog("Tool:input_text", "Executing with input:", input);
      try {
        const args = typeof input === "string" ? (input ? JSON.parse(input) : {}) : input;
        const result = await sendToContentScript(tabId, {
          type: MessageType.INPUT_TEXT,
          payload: args,
        });
        return JSON.stringify(result, null, 2);
      } catch (error) {
        errorLog("Tool:input_text", "Error:", error);
        return JSON.stringify({ error: (error as Error).message });
      }
    },
  });

  const scrollPageTool = new DynamicTool({
    name: "scroll_page",
    description:
      "Scroll the page. Input: JSON with \"direction\" (required, one of: top, bottom, up, down), \"amount\" (number, optional, default 500 - only applies to up/down).",
    func: async (input: string) => {
      debugLog("Tool:scroll_page", "Executing with input:", input);
      try {
        const args = typeof input === "string" ? (input ? JSON.parse(input) : {}) : input;
        const result = await sendToContentScript(tabId, {
          type: MessageType.SCROLL_PAGE,
          payload: args,
        });
        return JSON.stringify(result, null, 2);
      } catch (error) {
        errorLog("Tool:scroll_page", "Error:", error);
        return JSON.stringify({ error: (error as Error).message });
      }
    },
  });

  const hoverElementTool = new DynamicTool({
    name: "hover_element",
    description:
      "Hover over an element to trigger dropdown menus or tooltips. Input: JSON with \"selector\" (CSS selector, required), \"waitAfter\" (ms, optional, default 500).",
    func: async (input: string) => {
      debugLog("Tool:hover_element", "Executing with input:", input);
      try {
        const args = typeof input === "string" ? (input ? JSON.parse(input) : {}) : input;
        const result = await sendToContentScript(tabId, {
          type: MessageType.HOVER_ELEMENT,
          payload: args,
        });
        return JSON.stringify(result, null, 2);
      } catch (error) {
        errorLog("Tool:hover_element", "Error:", error);
        return JSON.stringify({ error: (error as Error).message });
      }
    },
  });

  const waitForElementTool = new DynamicTool({
    name: "wait_for_element",
    description:
      "Wait for an element to appear in the DOM. Useful for dynamically loaded content. Input: JSON with \"selector\" (CSS selector, required), \"timeout\" (ms, optional, default 10000).",
    func: async (input: string) => {
      debugLog("Tool:wait_for_element", "Executing with input:", input);
      try {
        const args = typeof input === "string" ? (input ? JSON.parse(input) : {}) : input;
        const result = await sendToContentScript(tabId, {
          type: MessageType.WAIT_FOR_ELEMENT,
          payload: args,
        });
        return JSON.stringify(result, null, 2);
      } catch (error) {
        errorLog("Tool:wait_for_element", "Error:", error);
        return JSON.stringify({ error: (error as Error).message });
      }
    },
  });

  const executeScriptTool = new DynamicTool({
    name: "execute_script",
    description:
      "Execute custom JavaScript in the page context. Use this for complex operations or accessing page-specific functions. Input: JSON with \"script\" (JavaScript code to execute, required). Returns the result as JSON.",
    func: async (input: string) => {
      debugLog("Tool:execute_script", "Executing with input:", input?.slice(0, 50));
      try {
        const args = typeof input === "string" ? (input ? JSON.parse(input) : {}) : input;
        const result = await sendToContentScript(tabId, {
          type: MessageType.EXECUTE_SCRIPT,
          payload: args,
        });
        return JSON.stringify(result, null, 2);
      } catch (error) {
        errorLog("Tool:execute_script", "Error:", error);
        return JSON.stringify({ error: (error as Error).message });
      }
    },
  });

  const navigateTool = new DynamicTool({
    name: "navigate",
    description:
      "Navigate to a new URL. Input: JSON with \"url\" (string, required). The page will be navigated and wait 2 seconds for loading.",
    func: async (input: string) => {
      debugLog("Tool:navigate", "Executing with input:", input);
      try {
        const args = typeof input === "string" ? (input ? JSON.parse(input) : {}) : input;
        const result = await sendToContentScript(tabId, {
          type: MessageType.NAVIGATE,
          payload: args,
        });
        return JSON.stringify(result, null, 2);
      } catch (error) {
        errorLog("Tool:navigate", "Error:", error);
        return JSON.stringify({ error: (error as Error).message });
      }
    },
  });

  const goBackTool = new DynamicTool({
    name: "go_back",
    description:
      "Go back to the previous page in browser history. Input: empty JSON object {}.",
    func: async () => {
      debugLog("Tool:go_back", "Executing");
      try {
        const result = await sendToContentScript(tabId, {
          type: MessageType.GO_BACK,
          payload: {},
        });
        return JSON.stringify(result, null, 2);
      } catch (error) {
        errorLog("Tool:go_back", "Error:", error);
        return JSON.stringify({ error: (error as Error).message });
      }
    },
  });

  const goForwardTool = new DynamicTool({
    name: "go_forward",
    description:
      "Go forward to the next page in browser history. Input: empty JSON object {}.",
    func: async () => {
      debugLog("Tool:go_forward", "Executing");
      try {
        const result = await sendToContentScript(tabId, {
          type: MessageType.GO_FORWARD,
          payload: {},
        });
        return JSON.stringify(result, null, 2);
      } catch (error) {
        errorLog("Tool:go_forward", "Error:", error);
        return JSON.stringify({ error: (error as Error).message });
      }
    },
  });

  const getCookiesTool = new DynamicTool({
    name: "get_cookies",
    description:
      "Get all cookies for the current page. Input: JSON with optional \"url\" (string). Returns array of cookies with name, value, domain, path, etc.",
    func: async (input: string) => {
      debugLog("Tool:get_cookies", "Executing");
      try {
        const args = typeof input === "string" ? (input ? JSON.parse(input) : {}) : input;
        const result = await sendToContentScript(tabId, {
          type: MessageType.GET_COOKIES,
          payload: args,
        });
        return JSON.stringify(result, null, 2);
      } catch (error) {
        errorLog("Tool:get_cookies", "Error:", error);
        return JSON.stringify({ error: (error as Error).message });
      }
    },
  });

  const setCookieTool = new DynamicTool({
    name: "set_cookie",
    description:
      "Set a cookie for the current page. Input: JSON with \"name\" (required), \"value\" (required), and optional \"url\", \"domain\", \"path\", \"expirationDate\", \"secure\", \"httpOnly\".",
    func: async (input: string) => {
      debugLog("Tool:set_cookie", "Executing with input:", input);
      try {
        const args = typeof input === "string" ? (input ? JSON.parse(input) : {}) : input;
        const result = await sendToContentScript(tabId, {
          type: MessageType.SET_COOKIE,
          payload: args,
        });
        return JSON.stringify(result, null, 2);
      } catch (error) {
        errorLog("Tool:set_cookie", "Error:", error);
        return JSON.stringify({ error: (error as Error).message });
      }
    },
  });

  const captureScreenshotTool = new DynamicTool({
    name: "capture_screenshot",
    description:
      "Capture a screenshot of the current page visible area. Input: empty JSON object {}. Returns base64 encoded image data.",
    func: async () => {
      debugLog("Tool:capture_screenshot", "Executing");
      try {
        const result = await sendMessage({
          type: MessageType.CAPTURE_SCREENSHOT,
          payload: {},
        });
        return JSON.stringify(result, null, 2);
      } catch (error) {
        errorLog("Tool:capture_screenshot", "Error:", error);
        return JSON.stringify({ error: (error as Error).message });
      }
    },
  });

  const getPageHtmlTool = new DynamicTool({
    name: "get_page_html",
    description:
      "Get the complete HTML source of the current page. Input: empty JSON object {}. Returns html, title, and url.",
    func: async () => {
      debugLog("Tool:get_page_html", "Executing");
      try {
        const result = await sendMessage({
          type: MessageType.GET_PAGE_HTML,
          payload: {},
        });
        return JSON.stringify(result, null, 2);
      } catch (error) {
        errorLog("Tool:get_page_html", "Error:", error);
        return JSON.stringify({ error: (error as Error).message });
      }
    },
  });

  const getNetworkRequestsTool = new DynamicTool({
    name: "get_network_requests",
    description:
      "Get a list of recent network requests captured by the debugger. Input: JSON with optional \"limit\" (number, default 20). Returns array of request/response objects.",
    func: async (input: string) => {
      debugLog("Tool:get_network_requests", "Executing");
      try {
        const args = typeof input === "string" ? (input ? JSON.parse(input) : {}) : input;
        const result = await sendMessage({
          type: MessageType.DEBUGGER_ATTACH,
          payload: { ...args, getRequests: true },
        });
        return JSON.stringify(result, null, 2);
      } catch (error) {
        errorLog("Tool:get_network_requests", "Error:", error);
        return JSON.stringify({ error: (error as Error).message });
      }
    },
  });

  return [
    querySelectorTool,
    searchPageTool,
    getPageInfoTool,
    getSelectedElementTool,
    clickElementTool,
    inputTextTool,
    scrollPageTool,
    hoverElementTool,
    waitForElementTool,
    executeScriptTool,
    navigateTool,
    goBackTool,
    goForwardTool,
    getCookiesTool,
    setCookieTool,
    captureScreenshotTool,
    getPageHtmlTool,
    getNetworkRequestsTool,
  ];
}

export function createChatModel(apiKey: string, baseUrl: string, model: string, temperature = 0): ChatOpenAI {
  infoLog("createChatModel", "Creating chat model:", { baseUrl, model, temperature });
  return new ChatOpenAI({
    apiKey,
    configuration: { baseURL: baseUrl },
    model,
    temperature,
    streaming: true,
  });
}

export interface AgentConfig {
  model: ChatOpenAI;
  tools: ReturnType<typeof createChromeTools>;
  systemPrompt: string;
  tabId: number;
}

export function createAgentForTab(
  apiKey: string,
  baseUrl: string,
  model: string,
  temperature: number,
  tabId: number,
  systemPrompt: string
): AgentConfig {
  infoLog("createAgentForTab", "Creating agent for tab", { model, baseUrl, tabId });

  const chatModel = createChatModel(apiKey, baseUrl, model, temperature);
  const tools = createChromeTools(tabId);

  return {
    model: chatModel.bindTools(tools),
    tools,
    systemPrompt,
    tabId,
  };
}

export function toLangChainMessages(messages: ChatMessage[]): BaseMessage[] {
  debugLog("toLangChainMessages", "Converting", messages.length, "messages");

  return messages.map((msg, index) => {
    debugLog("toLangChainMessages", `Message ${index}:`, msg.role, msg.content?.slice(0, 50));

    switch (msg.role) {
      case "user":
        return new HumanMessage(msg.content);
      case "assistant": {
        if (msg.tool_calls?.length) {
          debugLog("toLangChainMessages", `Message ${index} has ${msg.tool_calls.length} tool_calls`);
          return new AIMessage({
            content: msg.content || "",
            tool_calls: msg.tool_calls.map((tc) => ({
              id: tc.id,
              type: "tool_call" as const,
              name: tc.function.name,
              args: tc.function.arguments,
            })),
          });
        }
        return new AIMessage(msg.content);
      }
      case "tool":
        return new ToolMessage({
          content: msg.content,
          tool_call_id: msg.tool_call_id!,
        });
      case "system":
        return new SystemMessage(msg.content);
      default:
        return new HumanMessage(msg.content);
    }
  });
}

export interface AgentStreamChunk {
  type: "content" | "tool_call" | "finish";
  data: string | { id: string; name: string; args: Record<string, unknown> }[];
}

export async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  tools: ReturnType<typeof createChromeTools>
): Promise<string> {
  const tool = tools.find((t) => t.name === toolName);
  if (!tool) {
    return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
  try {
    const result = await tool.func(JSON.stringify(args));
    return result;
  } catch (error) {
    return JSON.stringify({ error: (error as Error).message });
  }
}

export async function* streamAgentResponse(
  agent: AgentConfig,
  input: string,
  signal: AbortSignal
): AsyncGenerator<AgentStreamChunk> {
  infoLog("streamAgentResponse", "Starting agent stream");

  const conversationHistory: BaseMessage[] = [];

  while (!signal.aborted) {
    try {
      const messages: BaseMessage[] = [
        new SystemMessage(agent.systemPrompt),
        ...conversationHistory,
        new HumanMessage(input),
      ];

      const response = await agent.model.invoke(messages, { signal });
      conversationHistory.push(new HumanMessage(input));
      conversationHistory.push(response);

      if (response.tool_calls?.length) {
        yield {
          type: "tool_call",
          data: response.tool_calls.map((tc) => ({
            id: tc.id || `${Date.now()}-${tc.name}`,
            name: tc.name,
            args: typeof tc.args === "string" ? JSON.parse(tc.args) : (tc.args || {}),
          })),
        };

        const toolMessages: ToolMessage[] = [];
        for (const toolCall of response.tool_calls) {
          const args = typeof toolCall.args === "string" ? JSON.parse(toolCall.args) : (toolCall.args || {});
          const result = await executeToolCall(toolCall.name, args, agent.tools);
          toolMessages.push(
            new ToolMessage({
              content: result,
              tool_call_id: toolCall.id!,
            })
          );
        }

        conversationHistory.push(...toolMessages);
        input = "";
      } else {
        if (response.content) {
          yield { type: "content", data: String(response.content) };
        }
        yield { type: "finish", data: [] };
        break;
      }
    } catch (error) {
      errorLog("streamAgentResponse", "Agent stream error:", error);
      throw error;
    }
  }

  infoLog("streamAgentResponse", "Agent stream complete");
}

function msgToApi(msg: BaseMessage): Record<string, unknown> {
  const type = msg._getType();
  debugLog("msgToApi", "Converting message type:", type);

  if (type === "system") return { role: "system", content: msg.content };
  if (type === "human") {
    if (typeof msg.content !== "string" && Array.isArray(msg.content)) {
      return { role: "user", content: msg.content };
    }
    return { role: "user", content: msg.content };
  }
  if (type === "ai") {
    const ai = msg as AIMessage;
    const entry: Record<string, unknown> = { role: "assistant", content: ai.content || null };
    if (ai.tool_calls?.length) {
      entry.tool_calls = ai.tool_calls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: {
          name: tc.name,
          arguments: typeof tc.args === "string" ? tc.args : JSON.stringify(tc.args),
        },
      }));
    }
    const rc = ai.additional_kwargs?.reasoning_content;
    if (rc) entry.reasoning_content = rc;
    return entry;
  }
  if (type === "tool") {
    return { role: "tool", tool_call_id: (msg as ToolMessage).tool_call_id, content: msg.content };
  }
  return { role: "user", content: msg.content };
}

export async function* streamFollowUp(
  apiKey: string,
  baseUrl: string,
  model: string,
  history: BaseMessage[],
  assistantMsg: AIMessage,
  toolMsgs: ToolMessage[],
  signal: AbortSignal
): AsyncGenerator<string> {
  infoLog("streamFollowUp", "Starting follow-up stream", { baseUrl, model, historyLength: history.length, toolMsgsCount: toolMsgs.length });

  const apiMessages: Record<string, unknown>[] = [];
  for (const m of history) apiMessages.push(msgToApi(m));
  for (const m of toolMsgs) apiMessages.push(msgToApi(m));

  debugLog("streamFollowUp", "API messages prepared:", apiMessages.length, "messages");

  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const endpoint = normalizedBase.endsWith("/chat/completions")
    ? normalizedBase
    : normalizedBase + "/chat/completions";

  infoLog("streamFollowUp", "Sending request to:", endpoint);

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages: apiMessages, stream: true }),
      signal,
    });
  } catch (fetchError) {
    errorLog("streamFollowUp", "Fetch failed:", fetchError);
    throw fetchError;
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    errorLog("streamFollowUp", "API error response:", res.status, body);
    throw new Error(`API error: ${res.status} ${body}`);
  }

  if (!res.body) {
    errorLog("streamFollowUp", "Response body is empty");
    throw new Error("Response body is empty");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    let readResult: { done: boolean; value?: Uint8Array };
    try {
      readResult = await reader.read();
    } catch (readError) {
      errorLog("streamFollowUp", "Error reading stream:", readError);
      throw readError;
    }

    const { done, value } = readResult;
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      if (data === "[DONE]") return;
      try {
        const parsed = JSON.parse(data);
        const choice = parsed.choices?.[0];
        if (!choice?.delta) continue;

        const content = choice.delta.content;
        const reasoningContent = choice.delta.reasoning_content;

        if (content) yield content;
        if (reasoningContent) yield reasoningContent;
      } catch (e) {
        warnLog("streamFollowUp", "Failed to parse SSE data:", data, e);
      }
    }
  }
}
