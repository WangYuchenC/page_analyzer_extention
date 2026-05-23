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

export interface PageData {
  url: string;
  title: string;
  html: string;
  screenshot?: string;
  selectedElement?: ElementInfo;
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

export enum MessageType {
  ELEMENT_SELECTED = 'ELEMENT_SELECTED',
  ELEMENT_HIGHLIGHT = 'ELEMENT_HIGHLIGHT',
  CAPTURE_SCREENSHOT = 'CAPTURE_SCREENSHOT',
  GET_PAGE_HTML = 'GET_PAGE_HTML',
  GET_PAGE_INFO = 'GET_PAGE_INFO',
  GET_PAGE_SUMMARY = 'GET_PAGE_SUMMARY',
  GET_SELECTED_ELEMENT = 'GET_SELECTED_ELEMENT',
  QUERY_SELECTOR = 'QUERY_SELECTOR',
  SEARCH_PAGE = 'SEARCH_PAGE',
  DEBUGGER_ATTACH = 'DEBUGGER_ATTACH',
  DEBUGGER_DETACH = 'DEBUGGER_DETACH',
  DEBUGGER_SET_BREAKPOINT = 'DEBUGGER_SET_BREAKPOINT',
  DEBUGGER_RESUME = 'DEBUGGER_RESUME',
  NETWORK_REQUEST = 'NETWORK_REQUEST',
  NETWORK_RESPONSE = 'NETWORK_RESPONSE',
  LLM_ANALYZE = 'LLM_ANALYZE',
  LLM_GENERATE_CODE = 'LLM_GENERATE_CODE',
  OPEN_SIDE_PANEL = 'OPEN_SIDE_PANEL',
}

export interface Message<T = unknown> {
  type: MessageType;
  payload: T;
}
