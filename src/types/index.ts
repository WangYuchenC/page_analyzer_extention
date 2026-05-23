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

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  metadata?: {
    elementInfo?: ElementInfo;
    screenshot?: string;
    htmlSnippet?: string;
  };
}

export interface PageData {
  url: string;
  title: string;
  html: string;
  screenshot?: string;
  selectedElement?: ElementInfo;
}

export enum MessageType {
  ELEMENT_SELECTED = 'ELEMENT_SELECTED',
  ELEMENT_HIGHLIGHT = 'ELEMENT_HIGHLIGHT',
  CAPTURE_SCREENSHOT = 'CAPTURE_SCREENSHOT',
  GET_PAGE_HTML = 'GET_PAGE_HTML',
  GET_PAGE_INFO = 'GET_PAGE_INFO',
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
