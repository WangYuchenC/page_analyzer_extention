export interface ElementInfo {
  tagName: string;
  id?: string;
  className?: string;
  text?: string;
  xpath: string;
  cssSelector: string;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  outerHTML: string;
  innerText: string;
  attributes: Record<string, string>;
}

export interface NetworkRequest {
  requestId: string;
  url: string;
  method: string;
  headers?: Record<string, string>;
  postData?: string;
  timestamp: number;
}

export interface NetworkResponse {
  requestId: string;
  url: string;
  status: number;
  statusText: string;
  headers?: Record<string, string>;
  body?: string;
  timestamp: number;
}

export type ChatRole = 'user' | 'assistant' | 'system' | 'tool';

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

export interface ToolCallInfo {
  id: string;
  name: string;
  status: 'running' | 'completed' | 'error';
  result?: string;
  error?: string;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
  metadata?: {
    elementInfo?: ElementInfo;
    screenshot?: string;
    htmlSnippet?: string;
    toolCallInfos?: ToolCallInfo[];
  };
}

export interface PageSummary {
  url: string;
  title: string;
  metaDescription: string;
  language: string;
  headings: Array<{ level: number; text: string }>;
  linkCount: number;
  imageCount: number;
  textContentLength: number;
  mainContentPreview: string;
}

export interface StreamChunk {
  id?: string;
  object?: string;
  created?: number;
  model?: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
      reasoning_content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason: 'stop' | 'tool_calls' | 'length' | null;
  }>;
  error?: { message: string; type: string };
}

export interface ClickElementPayload {
  selector: string;
  waitBefore?: number;
  waitAfter?: number;
}

export interface InputTextPayload {
  selector: string;
  text: string;
  submit?: boolean;
}

export interface ScrollPagePayload {
  direction: 'top' | 'bottom' | 'up' | 'down';
  amount?: number;
}

export interface HoverElementPayload {
  selector: string;
  waitAfter?: number;
}

export interface WaitForElementPayload {
  selector: string;
  timeout?: number;
}

export interface ExecuteScriptPayload {
  script: string;
}

export interface NavigatePayload {
  url: string;
}

export interface GetCookiesPayload {
  url?: string;
}

export interface SetCookiePayload {
  name: string;
  value: string;
  url?: string;
  domain?: string;
  path?: string;
  expirationDate?: number;
  secure?: boolean;
  httpOnly?: boolean;
}

export enum MessageType {
  ELEMENT_SELECTED = 'ELEMENT_SELECTED',
  ELEMENT_HIGHLIGHT = 'ELEMENT_HIGHLIGHT',
  CAPTURE_SCREENSHOT = 'CAPTURE_SCREENSHOT',
  GET_PAGE_HTML = 'GET_PAGE_HTML',
  GET_PAGE_SUMMARY = 'GET_PAGE_SUMMARY',
  GET_SELECTED_ELEMENT = 'GET_SELECTED_ELEMENT',
  QUERY_SELECTOR = 'QUERY_SELECTOR',
  SEARCH_PAGE = 'SEARCH_PAGE',
  DEBUGGER_ATTACH = 'DEBUGGER_ATTACH',
  DEBUGGER_DETACH = 'DEBUGGER_DETACH',
  NETWORK_REQUEST = 'NETWORK_REQUEST',
  NETWORK_RESPONSE = 'NETWORK_RESPONSE',
  
  CLICK_ELEMENT = 'CLICK_ELEMENT',
  INPUT_TEXT = 'INPUT_TEXT',
  SCROLL_PAGE = 'SCROLL_PAGE',
  HOVER_ELEMENT = 'HOVER_ELEMENT',
  WAIT_FOR_ELEMENT = 'WAIT_FOR_ELEMENT',
  EXECUTE_SCRIPT = 'EXECUTE_SCRIPT',
  NAVIGATE = 'NAVIGATE',
  GET_COOKIES = 'GET_COOKIES',
  SET_COOKIE = 'SET_COOKIE',
  GO_BACK = 'GO_BACK',
  GO_FORWARD = 'GO_FORWARD',
}

export interface Message<T = unknown> {
  type: MessageType;
  payload: T;
}
