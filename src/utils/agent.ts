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

/**
 * Sleep for a given number of milliseconds.
 */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retry an async function on rate-limit (429) errors with exponential backoff.
 * AbortError / Cancel errors bypass retry and re-throw immediately.
 */
async function retryOnRateLimit<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  baseDelay = 2000
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error as Error;
      // Don't retry on abort
      if (error?.name === "AbortError" || error?.name === "Cancel") throw error;
      // Check for rate-limit indicators
      const status = error?.status ?? error?.statusCode;
      const message = (error?.message ?? "").toLowerCase();
      const isRateLimit =
        status === 429 ||
        message.includes("429") ||
        message.includes("rate limit");
      if (!isRateLimit || attempt >= maxRetries) throw error;
      // Exponential backoff with jitter
      const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000;
      warnLog("retryOnRateLimit", `Rate limited (attempt ${attempt + 1}/${maxRetries}), retrying in ${Math.round(delay)}ms`);
      // Check signal between retries (via fn's closure)
      await sleep(delay);
    }
  }
  throw lastError ?? new Error("Retry failed");
}

const REASONING_REGEX = /^\[思考过程\]\n([\s\S]*?)\n\[\/思考过程\]\n?/;

/**
 * Extract reasoning_content from message content that contains
 * [思考过程] markers (as yielded by streamAgentResponse), returning
 * clean content and the separate reasoning text.
 */
function extractReasoningContent(content: string): {
  cleanContent: string;
  reasoningContent?: string;
} {
  const match = content.match(REASONING_REGEX);
  if (!match) return { cleanContent: content };
  return {
    cleanContent: content.slice(match[0].length),
    reasoningContent: match[1],
  };
}

function parseInput(input: string): Record<string, unknown> {
  if (!input) return {};
  try {
    const parsed = typeof input === "string" ? JSON.parse(input) : input;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    // DynamicTool + bindTools wraps args as {input: '{"key": "val"}'}
    // Only unwrap if:
    // 1. The parsed object has exactly one key called "input"
    // 2. The value of "input" is a string
    // 3. The string starts with "{" or "[" (looks like JSON structure)
    // This avoids false positives when a tool legitimately has an "input" param
    // with a plain string value like {input: "hello"} or {input: "42"}
    const keys = Object.keys(parsed);
    if (
      keys.length === 1 &&
      keys[0] === "input" &&
      typeof parsed.input === "string"
    ) {
      const trimmed = parsed.input.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          return JSON.parse(parsed.input);
        } catch {
          return parsed;
        }
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
      "Execute custom JavaScript in the page context. Input: JSON with \"script\" (JavaScript code to execute, required). Returns the result as JSON.",
    func: async (input: string) => {
      debugLog("Tool:execute_script", "Executing with input:", input?.slice(0, 50));
      try {
        const args = parseInput(input);
        const validation = validateRequired(args, ["script"]);
        if (validation) return JSON.stringify({ error: validation });
        const strValidation = validateString(args, ["script"]);
        if (strValidation) return JSON.stringify({ error: strValidation });

        // Use CDP via background.ts to bypass page CSP (new Function() in
        // content script would be blocked). Background handles debugger
        // attach/detach lifecycle with proper cleanup.
        const result = await sendMessage(MessageType.EXECUTE_SCRIPT, {
          tabId,
          script: args.script as string,
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
      "Navigate to a new URL. Input: JSON with \"url\" (string, required). The page will be navigated and wait up to 15 seconds for loading.",
    func: async (input: string) => {
      debugLog("Tool:navigate", "Executing with input:", input);
      try {
        const args = parseInput(input);
        const validation = validateRequired(args, ["url"]);
        if (validation) return JSON.stringify({ error: validation });
        const strValidation = validateString(args, ["url"]);
        if (strValidation) return JSON.stringify({ error: strValidation });
        
        // Include tabId so background.ts's handler can identify the target tab
        // even when the message comes from the side panel (sender.tab is undefined)
        const result = await sendMessage(MessageType.NAVIGATE, { ...args, tabId });
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
        const result = await sendMessage(MessageType.GO_BACK, { tabId });
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
        const result = await sendMessage(MessageType.GO_FORWARD, { tabId });
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
  maxIterations: number;
}

export function createAgentForTab(
  apiKey: string,
  baseUrl: string,
  model: string,
  temperature: number,
  tabId: number,
  systemPrompt: string,
  maxIterations = 999
): AgentConfig {
  infoLog("createAgentForTab", "Creating agent for tab", { model, baseUrl, tabId, maxIterations });

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
    maxIterations,
  };
}

export function toLangChainMessages(messages: ChatMessage[]): BaseMessage[] {
  debugLog("toLangChainMessages", "Converting", messages.length, "messages");

  const MAX_TOTAL_CHARS = 40000;
  const MAX_MESSAGES = 50;
  const MAX_MSG_CHARS = 5000;

  // Filter out empty messages that have neither content nor tool_calls
  const validMessages = messages.filter((msg) => {
    if (!msg.content && !msg.tool_calls?.length) {
      debugLog("toLangChainMessages", `Filtering out empty message at index: ${messages.indexOf(msg)}`);
      return false;
    }
    return true;
  });

  // Step 1: Identify tool call chains.
  // A chain is: AIMessage(tool_calls) → ToolMessage → maybe more ToolMessages
  // All messages in a chain must be kept together to avoid confusing the LLM.
  const chainGroup = new Array<number>(validMessages.length).fill(-1);
  let groupId = 0;
  for (let i = 0; i < validMessages.length; i++) {
    if (validMessages[i].role === "assistant" && validMessages[i].tool_calls?.length) {
      chainGroup[i] = groupId;
      for (let j = i + 1; j < validMessages.length; j++) {
        if (validMessages[j].role === "tool") {
          chainGroup[j] = groupId;
        } else {
          break; // non-tool message ends the chain
        }
      }
      i += validMessages.slice(i + 1).findIndex((m) => m.role !== "tool") + 1;
      if (i < validMessages.length - 1 && validMessages[i].role !== "tool") i--; // back up
      groupId++;
    }
  }

  // Step 2: Convert valid messages to BaseMessage format (before truncation)
  const converted: BaseMessage[] = validMessages.map((msg) => {
    const rawContent = typeof msg.content === "string" ? msg.content : "";
    const truncatedContent = rawContent.length > MAX_MSG_CHARS
      ? rawContent.slice(0, MAX_MSG_CHARS) + `\n... [truncated ${rawContent.length - MAX_MSG_CHARS} chars]`
      : rawContent;

    switch (msg.role) {
      case "user":
        return new HumanMessage(truncatedContent);
      case "assistant": {
        // Extract [思考过程] markers into additional_kwargs.reasoning_content
        // so DeepSeek API receives the field it requires on follow-up calls.
        const { cleanContent, reasoningContent } = extractReasoningContent(truncatedContent);
        const additionalKwargs: Record<string, unknown> = {};
        if (reasoningContent) additionalKwargs.reasoning_content = reasoningContent;
        if (msg.tool_calls?.length) {
          return new AIMessage({
            content: cleanContent || "",
            tool_calls: msg.tool_calls.map((tc) => ({
              id: tc.id,
              type: "tool_call" as const,
              name: tc.function.name,
              args: typeof tc.function.arguments === "string" ? JSON.parse(tc.function.arguments) : tc.function.arguments,
            })),
            additional_kwargs: additionalKwargs,
          });
        }
        return new AIMessage({ content: cleanContent, additional_kwargs: additionalKwargs });
      }
      case "tool":
        return new ToolMessage({
          content: truncatedContent,
          tool_call_id: msg.tool_call_id!,
        });
      case "system":
        return new SystemMessage(truncatedContent);
      default:
        return new HumanMessage(truncatedContent);
    }
  });

  // Step 3: Apply MAX_MESSAGES limit first (keep messages from the end, respecting chains)
  const sliced: { msg: BaseMessage; group: number }[] = [];
  const recentStart = Math.max(0, converted.length - MAX_MESSAGES);
  for (let i = recentStart; i < converted.length; i++) {
    sliced.push({ msg: converted[i], group: chainGroup[i] });
  }

  // Step 4: Apply MAX_TOTAL_CHARS truncation from the front, respecting chain groups.
  let totalChars = 0;
  const result: BaseMessage[] = [];

  for (let i = sliced.length - 1; i >= 0; i--) {
    const { msg, group } = sliced[i];
    const contentLen = typeof msg.content === "string" ? msg.content.length : 0;

    // If this message belongs to a chain group, check if we already have any
    // message from the same group in the result. If we do, this one must also
    // be included to keep the chain intact.
    const chainStarted = group >= 0 && result.some((r) => {
      const rIdx = converted.indexOf(r);
      return rIdx >= 0 && chainGroup[rIdx] === group;
    });

    if (totalChars + contentLen > MAX_TOTAL_CHARS && result.length > 0 && !chainStarted) {
      debugLog("toLangChainMessages", "Context limit reached, stopping");
      break;
    }

    totalChars += contentLen;
    result.unshift(msg);
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

/**
 * Normalize tool error responses to a consistent format.
 * Content script tools return {success: false, error: "..."} but
 * agent tools expect {error: "..."}. This bridges the gap.
 */
function normalizeToolResponse(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      // Detect {success: false, error: "..."} from content script
      if (parsed.success === false && parsed.error) {
        return JSON.stringify({ error: parsed.error });
      }
      // {success: true, ...} → strip success field, keep the rest
      if (parsed.success === true) {
        const { success, ...rest } = parsed;
        return JSON.stringify(rest);
      }
    }
  } catch {
    // Not JSON, return as-is
  }
  return raw;
}

/**
 * JSON-aware truncation that preserves valid JSON structure.
 * - Arrays: keep first N items
 * - Objects: keep first N keys
 * - Non-JSON strings: slice with ellipsis
 */
function truncateToolResult(raw: string, maxChars: number): string {
  if (raw.length <= maxChars) return raw;

  const TRUNC_SUFFIX_LEN = 80; // reserve space for the truncation notice
  const effectiveMax = maxChars - TRUNC_SUFFIX_LEN;

  try {
    const parsed = JSON.parse(raw);

    // Array → keep leading items
    if (Array.isArray(parsed) && parsed.length > 0) {
      const kept: unknown[] = [];
      let size = 2; // "[]"
      for (const item of parsed) {
        const str = JSON.stringify(item);
        if (size + str.length + (kept.length > 0 ? 1 : 0) > effectiveMax) break;
        kept.push(item);
        size += str.length + (kept.length > 0 ? 1 : 0);
      }
      const dropped = parsed.length - kept.length;
      return JSON.stringify(kept, null, 2) + `\n... [truncated: ${dropped} of ${parsed.length} items]`;
    }

    // Object → keep leading keys
    if (typeof parsed === "object" && parsed !== null) {
      const entries = Object.entries(parsed);
      const kept: Record<string, unknown> = {};
      let size = 2; // "{}"
      for (const [key, val] of entries) {
        const str = JSON.stringify({ [key]: val });
        if (size + str.length - 1 > effectiveMax) break;
        kept[key] = val;
        size += str.length - 1; // -1 for reducing outer braces
      }
      const dropped = entries.length - Object.keys(kept).length;
      return JSON.stringify(kept, null, 2) + `\n... [truncated: ${dropped} keys dropped]`;
    }
  } catch {
    // Not valid JSON, fall through to string truncation
  }

  // Fallback: safe string truncation
  return raw.slice(0, effectiveMax) + `\n... [truncated ${raw.length - effectiveMax} chars]`;
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
    const raw = typeof result === "string" ? result : JSON.stringify(result);
    return normalizeToolResponse(raw);
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
  const MAX_ITERATIONS = agent.maxIterations;
  let currentInput = input;
  let iteration = 0;
  let accumulatedReasoning = '';

  while (!signal.aborted) {
    iteration++;

    if (iteration > MAX_ITERATIONS) {
      warnLog("streamAgentResponse", `Max iterations (${MAX_ITERATIONS}) reached, stopping tool loop`);
      yield {
        type: "content",
        data: `\n\n[已达到最大工具调用次数(${MAX_ITERATIONS})，请尝试更具体地描述您的问题，或增大最大迭代次数配置]`,
      };
      break;
    }

    try {
      let response: AIMessageChunk;

      const messages: BaseMessage[] = [
        new SystemMessage(agent.systemPrompt),
        ...conversationHistory,
      ];
      if (currentInput.trim()) {
        messages.push(new HumanMessage(currentInput));
      }

      infoLog("streamAgentResponse", "=== Sending to LLM ===");
      infoLog("streamAgentResponse", `Total messages: ${messages.length}`);
      infoLog("streamAgentResponse", `System prompt length: ${agent.systemPrompt.length} chars`);
      infoLog("streamAgentResponse", `History messages: ${conversationHistory.length}`);
      infoLog("streamAgentResponse", `Current input: "${currentInput.slice(0, 100)}${currentInput.length > 100 ? "..." : ""}"`);

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

      // Determine whether we need invokeModelRaw (which uses msgToApi and
      // properly includes additional_kwargs.reasoning_content) vs LangChain's
      // streaming model (which drops reasoning_content from its serialization).
      //
      // Two cases:
      //   1. history (previous turns) has reasoning_content — must use
      //      invokeModelRaw even on iteration 1, since LangChain would drop
      //      the field and DeepSeek rejects the request with 400.
      //   2. WE accumulated reasoning_content during THIS streaming session
      //      (iteration >= 2) — switch to invokeModelRaw for follow-up calls.
      const historyHasReasoning = history.length > 0 && history.some(
        (m) => (m.additional_kwargs as Record<string, unknown>)?.reasoning_content
      );
      const sessionHasReasoning = !historyHasReasoning && iteration > 1 &&
        conversationHistory.slice(history.length).some(
          (m) => (m.additional_kwargs as Record<string, unknown>)?.reasoning_content
        );
      const useRawFetch = historyHasReasoning || sessionHasReasoning;

      if (useRawFetch) {
        // invokeModelRaw already wraps retryOnRateLimit internally
        response = await invokeModelRaw(agent, currentInput, conversationHistory, signal);
        // Yield reasoning_content from DeepSeek thinking mode (if present in follow-up)
        const rc = (response.additional_kwargs as Record<string, unknown>)?.reasoning_content;
        if (rc) {
          yield { type: "content", data: `\n[思考过程]\n${rc as string}\n[/思考过程]\n` };
        }
        if (response.content) {
          yield { type: "content", data: String(response.content) };
        }
      } else {
        // First iteration (no reasoning_content yet) — use streaming for
        // real-time token delivery
        const llmStream = await retryOnRateLimit(() => agent.model.stream(messages, { signal }));
        // Accumulate via concat() which properly merges tool_call_chunks
        // and additional_kwargs across multiple stream chunks
        let accumulated = new AIMessageChunk({ content: "" });

        for await (const chunk of llmStream) {
          if (signal.aborted) break;

          accumulated = accumulated.concat(chunk);

          // Accumulate reasoning_content from DeepSeek thinking mode during streaming.
          // DeepSeek sends reasoning_content as delta tokens (not full accumulated text),
          // so each chunk's reasoning_content is appended to build the complete thought.
          // We batch-yield once at the transition from thinking → response phase to
          // avoid flooding the UI with one `[思考过程]` wrapper per token.
          const reasoning = (chunk.additional_kwargs as Record<string, unknown>)?.reasoning_content;
          if (reasoning) {
            accumulatedReasoning += reasoning as string;
          }
          if (chunk.content && accumulatedReasoning) {
            // Transition: thinking phase just ended — yield accumulated reasoning once
            yield { type: "content", data: `\n[思考过程]\n${accumulatedReasoning}\n[/思考过程]\n` };
            accumulatedReasoning = '';
            yield { type: "content", data: String(chunk.content) };
          } else if (chunk.content) {
            yield { type: "content", data: String(chunk.content) };
          }
        }
        response = accumulated;

        // Flush any remaining accumulated reasoning (e.g., when response has
        // tool_calls and the stream ended without a content transition)
        if (accumulatedReasoning) {
          yield { type: "content", data: `\n[思考过程]\n${accumulatedReasoning}\n[/思考过程]\n` };
          accumulatedReasoning = '';
        }
      }

      if (currentInput.trim()) {
        conversationHistory.push(new HumanMessage(currentInput));
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
          const truncated = truncateToolResult(rawResult, MAX_TOOL_RESULT_CHARS);
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
        currentInput = ""; // clear input, next iteration uses history only

        // Prevent unbounded growth: keep only the most recent messages
        // (tool call chains at the end are naturally preserved by slicing from front)
        const MAX_CONVERSATION_HISTORY = 60;
        if (conversationHistory.length > MAX_CONVERSATION_HISTORY) {
          const excess = conversationHistory.length - MAX_CONVERSATION_HISTORY;
          conversationHistory.splice(0, excess);
          debugLog("streamAgentResponse", `Trimmed ${excess} messages from conversation history`);
        }
      } else {
        // Content already streamed chunk-by-chunk above
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

  // Define proper JSON Schema parameters for each tool
  // so that DeepSeek / reasoning models know what params each tool expects
  const toolParamSchemas: Record<string, Record<string, unknown>> = {
    query_selector: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector to query" },
        maxResults: { type: "number", description: "Maximum results (default 5, max 20)" },
        includeHtml: { type: "boolean", description: "Include HTML content in results" },
      },
      required: ["selector"],
    },
    search_page: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text to search for on the page" },
        maxResults: { type: "number", description: "Maximum results (default 10, max 30)" },
        contextChars: { type: "number", description: "Context characters around match (default 80)" },
      },
      required: ["query"],
    },
    get_page_info: {
      type: "object",
      properties: {},
    },
    get_selected_element: {
      type: "object",
      properties: {},
    },
    click_element: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector of element to click" },
        waitBefore: { type: "number", description: "Milliseconds to wait before click" },
        waitAfter: { type: "number", description: "Milliseconds to wait after click (default 500)" },
      },
      required: ["selector"],
    },
    input_text: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector of input field" },
        text: { type: "string", description: "Text to input into the field" },
        submit: { type: "boolean", description: "Whether to submit the form after input" },
      },
      required: ["selector", "text"],
    },
    scroll_page: {
      type: "object",
      properties: {
        direction: { type: "string", enum: ["top", "bottom", "up", "down"], description: "Scroll direction" },
        amount: { type: "number", description: "Scroll amount in pixels for up/down (default 500)" },
      },
      required: ["direction"],
    },
    hover_element: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector of element to hover" },
        waitAfter: { type: "number", description: "Milliseconds to wait after hover (default 500)" },
      },
      required: ["selector"],
    },
    wait_for_element: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector of element to wait for" },
        timeout: { type: "number", description: "Maximum wait time in ms (default 10000)" },
      },
      required: ["selector"],
    },
    execute_script: {
      type: "object",
      properties: {
        script: { type: "string", description: "JavaScript code to execute in page context" },
      },
      required: ["script"],
    },
    navigate: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to navigate to" },
      },
      required: ["url"],
    },
    go_back: { type: "object", properties: {} },
    go_forward: { type: "object", properties: {} },
    get_cookies: {
      type: "object",
      properties: {
        url: { type: "string", description: "URL to get cookies for (defaults to current page)" },
      },
    },
    set_cookie: {
      type: "object",
      properties: {
        name: { type: "string", description: "Cookie name" },
        value: { type: "string", description: "Cookie value" },
        url: { type: "string", description: "Cookie URL" },
        domain: { type: "string", description: "Cookie domain" },
        path: { type: "string", description: "Cookie path" },
        expirationDate: { type: "number", description: "Cookie expiration as Unix timestamp" },
        secure: { type: "boolean" },
        httpOnly: { type: "boolean" },
      },
      required: ["name", "value"],
    },
    capture_screenshot: { type: "object", properties: {} },
    get_page_html: { type: "object", properties: {} },
    get_network_requests: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Maximum requests to return (default 20)" },
      },
    },
  };

  const tools = agent.tools.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: toolParamSchemas[tool.name] || { type: "object", properties: {} },
    },
  }));

  const doFetch = async (): Promise<Response> => {
    const r = await fetch(endpoint, {
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
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      const err: any = new Error(`API error: ${r.status} ${body}`);
      err.status = r.status;
      throw err;
    }
    return r;
  };

  const res = await retryOnRateLimit(doFetch);

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

/**
 * Convert LangChain message content (possibly complex arrays with image_url etc.)
 * to OpenAI-compatible format.
 */
function convertContent(content: unknown): unknown {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((item) => {
      if (typeof item === "string") return { type: "text", text: item };
      if (typeof item === "object" && item !== null) {
        if ("image_url" in item) {
          return {
            type: "image_url",
            image_url:
              typeof item.image_url === "string"
                ? { url: item.image_url }
                : item.image_url,
          };
        }
        return item;
      }
      return String(item);
    });
  }
  return String(content);
}

export function msgToApi(msg: BaseMessage): Record<string, unknown> {
  const type = msg._getType();
  debugLog("msgToApi", "Converting message type:", type);

  if (type === "system") return { role: "system", content: convertContent(msg.content) };
  if (type === "human") return { role: "user", content: convertContent(msg.content) };
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
  return { role: "user", content: convertContent(msg.content) };
}

