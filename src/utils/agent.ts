import { ChatOpenAI } from "@langchain/openai";
import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from "@langchain/core/messages";
import { DynamicTool } from "@langchain/core/tools";
import { debugLog, errorLog, infoLog, warnLog } from "./logger";
import { MessageType } from "../types";
import { sendToContentScript, sendMessage } from "./messaging";
import type { ChatMessage } from "../types";

function parseInput(input: string): Record<string, unknown> {
  if (!input) return {};
  try {
    const parsed = typeof input === "string" ? JSON.parse(input) : input;
    // DynamicTool + bindTools wraps args as {input: '{"key": "val"}'}
    // Unwrap if the only key is "input" containing a JSON string
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).length === 1 &&
      "input" in parsed &&
      typeof parsed.input === "string"
    ) {
      try {
        return JSON.parse(parsed.input);
      } catch {
        // nested value is not JSON, return the wrapper as-is
        return parsed;
      }
    }
    return parsed;
  } catch {
    warnLog("parseInput", "Failed to parse input:", input);
    return {};
  }
}

function validateRequired(args: Record<string, unknown>, required: string[]): string | null {
  const missing = required.filter((key) => args[key] === undefined || args[key] === null);
  if (missing.length > 0) {
    return `Missing required parameters: ${missing.join(", ")}`;
  }
  return null;
}

function validateString(args: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    if (args[key] !== undefined && typeof args[key] !== "string") {
      return `Parameter "${key}" must be a string`;
    }
  }
  return null;
}

function validateNumber(args: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    if (args[key] !== undefined && typeof args[key] !== "number") {
      return `Parameter "${key}" must be a number`;
    }
  }
  return null;
}

export function createChromeTools(tabId: number) {
  debugLog("createChromeTools", "Creating tools for tab:", tabId);

  const querySelectorTool = new DynamicTool({
    name: "query_selector",
    description:
      "Query the page DOM using a CSS selector. Returns text content, HTML, and attributes of matching elements. Input: JSON with \"selector\" (string, required), \"maxResults\" (number, optional, default 5, max 20), \"includeHtml\" (boolean, optional, default false).",
    func: async (input: string) => {
      debugLog("Tool:query_selector", "Executing with input:", input);
      try {
        const args = parseInput(input);
        const validation = validateRequired(args, ["selector"]);
        if (validation) return JSON.stringify({ error: validation });
        const strValidation = validateString(args, ["selector"]);
        if (strValidation) return JSON.stringify({ error: strValidation });
        
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
        const args = parseInput(input);
        const validation = validateRequired(args, ["query"]);
        if (validation) return JSON.stringify({ error: validation });
        const strValidation = validateString(args, ["query"]);
        if (strValidation) return JSON.stringify({ error: strValidation });
        
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
          type: MessageType.GET_PAGE_SUMMARY,
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
        const args = parseInput(input);
        const validation = validateRequired(args, ["selector"]);
        if (validation) return JSON.stringify({ error: validation });
        const strValidation = validateString(args, ["selector"]);
        if (strValidation) return JSON.stringify({ error: strValidation });
        
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
        const args = parseInput(input);
        const validation = validateRequired(args, ["selector", "text"]);
        if (validation) return JSON.stringify({ error: validation });
        const strValidation = validateString(args, ["selector", "text"]);
        if (strValidation) return JSON.stringify({ error: strValidation });
        
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
        const args = parseInput(input);
        const validation = validateRequired(args, ["direction"]);
        if (validation) return JSON.stringify({ error: validation });
        const strValidation = validateString(args, ["direction"]);
        if (strValidation) return JSON.stringify({ error: strValidation });
        
        const validDirections = ["top", "bottom", "up", "down"];
        if (!validDirections.includes(String(args.direction))) {
          return JSON.stringify({ error: `direction must be one of: ${validDirections.join(", ")}` });
        }
        
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
        const args = parseInput(input);
        const validation = validateRequired(args, ["selector"]);
        if (validation) return JSON.stringify({ error: validation });
        const strValidation = validateString(args, ["selector"]);
        if (strValidation) return JSON.stringify({ error: strValidation });
        
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
        const args = parseInput(input);
        const validation = validateRequired(args, ["selector"]);
        if (validation) return JSON.stringify({ error: validation });
        const strValidation = validateString(args, ["selector"]);
        if (strValidation) return JSON.stringify({ error: strValidation });
        
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
        const args = parseInput(input);
        const validation = validateRequired(args, ["script"]);
        if (validation) return JSON.stringify({ error: validation });
        const strValidation = validateString(args, ["script"]);
        if (strValidation) return JSON.stringify({ error: strValidation });
        
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
        const args = parseInput(input);
        const validation = validateRequired(args, ["url"]);
        if (validation) return JSON.stringify({ error: validation });
        const strValidation = validateString(args, ["url"]);
        if (strValidation) return JSON.stringify({ error: strValidation });
        
        const result = await sendMessage(MessageType.NAVIGATE, args);
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
        const result = await sendMessage(MessageType.GO_BACK, {});
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
        const result = await sendMessage(MessageType.GO_FORWARD, {});
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
        const args = parseInput(input);
        const strValidation = validateString(args, ["url"]);
        if (strValidation) return JSON.stringify({ error: strValidation });
        
        const result = await sendMessage(MessageType.GET_COOKIES, args);
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
        const args = parseInput(input);
        const validation = validateRequired(args, ["name", "value"]);
        if (validation) return JSON.stringify({ error: validation });
        const strValidation = validateString(args, ["name", "value", "url", "domain", "path"]);
        if (strValidation) return JSON.stringify({ error: strValidation });

        const result = await sendMessage(MessageType.SET_COOKIE, args);
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
        const result = await sendMessage(MessageType.CAPTURE_SCREENSHOT, {});
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
        const result = await sendMessage(MessageType.GET_PAGE_HTML, { tabId });
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
        const args = parseInput(input);
        const numValidation = validateNumber(args, ["limit"]);
        if (numValidation) return JSON.stringify({ error: numValidation });
        
        const result = await sendMessage(MessageType.DEBUGGER_ATTACH, { tabId, ...args, getRequests: true });
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

import type { Runnable } from "@langchain/core/runnables";
import type { BaseLanguageModelInput } from "@langchain/core/language_models/base";

export interface AgentConfig {
  model: Runnable<BaseLanguageModelInput, AIMessageChunk>;
  tools: ReturnType<typeof createChromeTools>;
  systemPrompt: string;
  tabId: number;
  apiKey: string;
  baseUrl: string;
  modelName: string;
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
    apiKey,
    baseUrl: baseUrl || "https://api.openai.com/v1",
    modelName: model,
  };
}

export function toLangChainMessages(messages: ChatMessage[]): BaseMessage[] {
  debugLog("toLangChainMessages", "Converting", messages.length, "messages");

  const MAX_TOTAL_CHARS = 40000;
  const MAX_MESSAGES = 50;
  
  const validMessages = messages.filter((msg) => {
    if (!msg.content && !msg.tool_calls?.length) {
      debugLog("toLangChainMessages", `Filtering out empty message at index: ${messages.indexOf(msg)}`);
      return false;
    }
    return true;
  });

  const recentMessages = validMessages.slice(-MAX_MESSAGES);

  let totalChars = 0;
  const result: BaseMessage[] = [];
  
  const MAX_MSG_CHARS = 5000;

  for (let i = recentMessages.length - 1; i >= 0; i--) {
    const msg = recentMessages[i];
    const rawContent = typeof msg.content === "string" ? msg.content : "";
    const truncatedContent = rawContent.length > MAX_MSG_CHARS
      ? rawContent.slice(0, MAX_MSG_CHARS) + `\n... [truncated ${rawContent.length - MAX_MSG_CHARS} chars]`
      : rawContent;
    const msgChars = truncatedContent.length;
    
    if (totalChars + msgChars > MAX_TOTAL_CHARS && result.length > 0) {
      debugLog("toLangChainMessages", "Context limit reached, stopping");
      break;
    }
    
    totalChars += msgChars;
    
    let baseMsg: BaseMessage;
    switch (msg.role) {
      case "user":
        baseMsg = new HumanMessage(truncatedContent);
        break;
      case "assistant": {
        if (msg.tool_calls?.length) {
          baseMsg = new AIMessage({
            content: truncatedContent || "",
            tool_calls: msg.tool_calls.map((tc) => ({
              id: tc.id,
              type: "tool_call" as const,
              name: tc.function.name,
              args: typeof tc.function.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function.arguments,
            })),
          });
        } else {
          baseMsg = new AIMessage(truncatedContent);
        }
        break;
      }
      case "tool":
        baseMsg = new ToolMessage({
          content: truncatedContent,
          tool_call_id: msg.tool_call_id!,
        });
        break;
      case "system":
        baseMsg = new SystemMessage(truncatedContent);
        break;
      default:
        baseMsg = new HumanMessage(truncatedContent);
    }
    
    result.unshift(baseMsg);
  }

  debugLog("toLangChainMessages", `Result: ${result.length} messages, ${totalChars} chars`);
  return result;
}

export interface ToolCallData {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResultData {
  id: string;
  name: string;
  status: "completed" | "error";
  result?: string;
  error?: string;
}

export interface AgentStreamChunk {
  type: "content" | "tool_call" | "tool_result" | "finish";
  data: string | ToolCallData[] | ToolResultData;
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
    return typeof result === "string" ? result : JSON.stringify(result);
  } catch (error) {
    return JSON.stringify({ error: (error as Error).message });
  }
}

export async function* streamAgentResponse(
  agent: AgentConfig,
  input: string,
  signal: AbortSignal,
  history: BaseMessage[] = []
): AsyncGenerator<AgentStreamChunk> {
  infoLog("streamAgentResponse", "Starting agent stream");

  const conversationHistory: BaseMessage[] = [...history];
  const MAX_TOOL_RESULT_CHARS = 5000;
  let pendingReasoningContent = false;

  while (!signal.aborted) {
    try {
      let response: AIMessageChunk;

      if (pendingReasoningContent) {
        // DeepSeek thinking mode requires reasoning_content to be echoed back,
        // but LangChain's @langchain/openai (v1.4.7) serializer drops
        // additional_kwargs.reasoning_content during serialization.
        // Bypass LangChain using raw fetch + msgToApi which preserves it.
        infoLog("streamAgentResponse", "Using raw API path to preserve reasoning_content");
        response = await invokeModelRaw(agent, input, conversationHistory, signal);
        pendingReasoningContent = false;
      } else {
        const messages: BaseMessage[] = [
          new SystemMessage(agent.systemPrompt),
          ...conversationHistory,
        ];
        if (input.trim()) {
          messages.push(new HumanMessage(input));
        }

        infoLog("streamAgentResponse", "=== Sending to LLM ===");
        infoLog("streamAgentResponse", `Total messages: ${messages.length}`);
        infoLog("streamAgentResponse", `System prompt length: ${agent.systemPrompt.length} chars`);
        infoLog("streamAgentResponse", `History messages: ${conversationHistory.length}`);
        infoLog("streamAgentResponse", `Current input: "${input.slice(0, 100)}${input.length > 100 ? "..." : ""}"`);

        messages.forEach((msg, index) => {
          const type = msg._getType();
          const contentPreview = typeof msg.content === "string"
            ? msg.content.slice(0, 150) + (msg.content.length > 150 ? "..." : "")
            : JSON.stringify(msg.content).slice(0, 150) + "...";
          infoLog("streamAgentResponse", `Message ${index} [${type}]: ${contentPreview}`);
        });

        const totalChars = messages.reduce((acc, msg) => {
          if (typeof msg.content === "string") return acc + msg.content.length;
          return acc + JSON.stringify(msg.content).length;
        }, 0);
        infoLog("streamAgentResponse", `Total content length: ${totalChars} chars (~${Math.floor(totalChars / 4)} tokens)`);
        infoLog("streamAgentResponse", "=== End LLM input ===");

        response = await agent.model.invoke(messages, { signal });
      }

      // Preserve reasoning_content flag for next iteration
      const rc = (response.additional_kwargs as Record<string, unknown>)?.reasoning_content;
      if (typeof rc === "string" && response.tool_calls?.length) {
        pendingReasoningContent = true;
      }

      if (input.trim()) {
        conversationHistory.push(new HumanMessage(input));
      }
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
          let rawResult: string;
          let toolStatus: "completed" | "error" = "completed";
          let toolError: string | undefined;
          try {
            rawResult = await executeToolCall(toolCall.name, args, agent.tools);
          } catch (error) {
            rawResult = JSON.stringify({ error: (error as Error).message });
            toolStatus = "error";
            toolError = (error as Error).message;
          }
          const truncated = rawResult.length > MAX_TOOL_RESULT_CHARS
            ? rawResult.slice(0, MAX_TOOL_RESULT_CHARS) + `\n... [truncated ${rawResult.length - MAX_TOOL_RESULT_CHARS} chars]`
            : rawResult;
          toolMessages.push(
            new ToolMessage({
              content: truncated,
              tool_call_id: toolCall.id!,
            })
          );
          yield {
            type: "tool_result",
            data: {
              id: toolCall.id || `${Date.now()}-${toolCall.name}`,
              name: toolCall.name,
              status: toolStatus,
              error: toolError,
            },
          };
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

async function invokeModelRaw(
  agent: AgentConfig,
  input: string,
  conversationHistory: BaseMessage[],
  signal: AbortSignal
): Promise<AIMessageChunk> {
  const apiMessages: Record<string, unknown>[] = [
    { role: "system", content: agent.systemPrompt },
  ];
  for (const msg of conversationHistory) {
    apiMessages.push(msgToApi(msg));
  }
  if (input.trim()) {
    apiMessages.push({ role: "user", content: input });
  }

  const normalizedBase = agent.baseUrl.replace(/\/+$/, "");
  const endpoint = normalizedBase.endsWith("/chat/completions")
    ? normalizedBase
    : normalizedBase + "/chat/completions";

  const tools = agent.tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: { type: "object", properties: {} as Record<string, unknown> },
    },
  }));

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${agent.apiKey}`,
    },
    body: JSON.stringify({
      model: agent.modelName,
      messages: apiMessages,
      tools,
      tool_choice: "auto",
      stream: false,
    }),
    signal,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API error: ${res.status} ${body}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  if (!choice) throw new Error("API response missing choices");

  const message = choice.message || {};
  const additionalKwargs: Record<string, unknown> = {};
  if (message.reasoning_content) {
    additionalKwargs.reasoning_content = message.reasoning_content;
  }

  const toolCalls = message.tool_calls?.map((tc: { id: string; function?: { name: string; arguments: string } }) => ({
    id: tc.id,
    type: "tool_call" as const,
    name: tc.function?.name,
    args: tc.function?.arguments ? JSON.parse(tc.function.arguments) : {},
  })) || [];

  return new AIMessageChunk({
    content: message.content || "",
    additional_kwargs: additionalKwargs,
    tool_calls: toolCalls,
  });
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
  if (assistantMsg) apiMessages.push(msgToApi(assistantMsg));
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
