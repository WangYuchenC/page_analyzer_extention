import { MessageType } from '~types';
import type { NetworkRequest, NetworkResponse } from '~types';

class DebuggerManager {
  private attachedTabs = new Set<number>();
  private networkRequests = new Map<number, Map<string, NetworkRequest>>();
  private networkResponses = new Map<number, Map<string, NetworkResponse>>();

  constructor() {
    chrome.debugger.onEvent.addListener(this.handleDebuggerEvent);
    chrome.debugger.onDetach.addListener(this.handleDetach);
  }

  async attach(tabId: number): Promise<void> {
    if (this.attachedTabs.has(tabId)) {
      return;
    }

    try {
      await chrome.debugger.attach({ tabId }, '1.3');
      this.attachedTabs.add(tabId);
      this.networkRequests.set(tabId, new Map());
      this.networkResponses.set(tabId, new Map());

      await chrome.debugger.sendCommand({ tabId }, 'Network.enable');
      await chrome.debugger.sendCommand({ tabId }, 'Debugger.enable');

      console.log(`Debugger attached to tab ${tabId}`);
    } catch (error) {
      console.error('Failed to attach debugger:', error);
      throw error;
    }
  }

  async detach(tabId: number): Promise<void> {
    if (!this.attachedTabs.has(tabId)) {
      return;
    }

    try {
      await chrome.debugger.detach({ tabId });
      this.attachedTabs.delete(tabId);
      this.networkRequests.delete(tabId);
      this.networkResponses.delete(tabId);
      console.log(`Debugger detached from tab ${tabId}`);
    } catch (error) {
      console.error('Failed to detach debugger:', error);
    }
  }

  private handleDebuggerEvent = (
    source: chrome.debugger.Debuggee,
    method: string,
    params: unknown
  ) => {
    const tabId = source.tabId;
    if (!tabId || !this.attachedTabs.has(tabId)) return;

    switch (method) {
      case 'Network.requestWillBeSent': {
        const requestParams = params as {
          requestId: string;
          request: { url: string; method: string; headers: Record<string, string>; postData?: string };
          timestamp: number;
        };
        const request: NetworkRequest = {
          requestId: requestParams.requestId,
          url: requestParams.request.url,
          method: requestParams.request.method,
          headers: requestParams.request.headers,
          postData: requestParams.request.postData,
          timestamp: requestParams.timestamp,
        };
        this.networkRequests.get(tabId)?.set(requestParams.requestId, request);

        chrome.runtime.sendMessage({
          type: MessageType.NETWORK_REQUEST,
          payload: request,
        }).catch(() => {});
        break;
      }

      case 'Network.responseReceived': {
        const responseParams = params as {
          requestId: string;
          response: { url: string; status: number; statusText: string; headers: Record<string, string> };
          timestamp: number;
        };
        const response: NetworkResponse = {
          requestId: responseParams.requestId,
          url: responseParams.response.url,
          status: responseParams.response.status,
          statusText: responseParams.response.statusText,
          headers: responseParams.response.headers,
          timestamp: responseParams.timestamp,
        };
        this.networkResponses.get(tabId)?.set(responseParams.requestId, response);

        this.fetchResponseBody(tabId, responseParams.requestId);
        break;
      }
    }
  };

  private async fetchResponseBody(tabId: number, requestId: string) {
    try {
      const result = await chrome.debugger.sendCommand(
        { tabId },
        'Network.getResponseBody',
        { requestId }
      ) as { body: string; base64Encoded: boolean };

      const response = this.networkResponses.get(tabId)?.get(requestId);
      if (response) {
        response.body = result.base64Encoded
          ? atob(result.body)
          : result.body;

        chrome.runtime.sendMessage({
          type: MessageType.NETWORK_RESPONSE,
          payload: response,
        }).catch(() => {});
      }
    } catch (error) {
      console.error('Failed to fetch response body:', error);
    }
  }

  private handleDetach = (source: chrome.debugger.Debuggee) => {
    if (source.tabId) {
      this.attachedTabs.delete(source.tabId);
      this.networkRequests.delete(source.tabId);
      this.networkResponses.delete(source.tabId);
    }
  };

  isAttached(tabId: number): boolean {
    return this.attachedTabs.has(tabId);
  }

  getNetworkRequests(tabId?: number): NetworkRequest[] {
    if (tabId) {
      return Array.from(this.networkRequests.get(tabId)?.values() ?? []);
    }
    const all: NetworkRequest[] = [];
    for (const map of this.networkRequests.values()) {
      all.push(...map.values());
    }
    return all;
  }

  getNetworkResponses(tabId?: number): NetworkResponse[] {
    if (tabId) {
      return Array.from(this.networkResponses.get(tabId)?.values() ?? []);
    }
    const all: NetworkResponse[] = [];
    for (const map of this.networkResponses.values()) {
      all.push(...map.values());
    }
    return all;
  }
}

const debuggerManager = new DebuggerManager();

chrome.runtime.onInstalled.addListener(() => {
  console.log('Page Analyzer Extension installed');
});

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    await chrome.sidePanel.open({ tabId: tab.id });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload } = message;

  switch (type) {
    case MessageType.CAPTURE_SCREENSHOT:
      handleCaptureScreenshot(sendResponse);
      return true;

    case MessageType.GET_PAGE_HTML:
      if (sender.tab?.id) {
        handleGetPageHTML(sender.tab.id, sendResponse);
        return true;
      }
      break;

    case MessageType.DEBUGGER_ATTACH:
      if (payload.tabId) {
        debuggerManager.attach(payload.tabId)
          .then(() => sendResponse({ success: true }))
          .catch((error) => sendResponse({ success: false, error: error.message }));
        return true;
      }
      break;

    case MessageType.DEBUGGER_DETACH:
      if (payload.tabId) {
        debuggerManager.detach(payload.tabId)
          .then(() => sendResponse({ success: true }))
          .catch((error) => sendResponse({ success: false, error: error.message }));
        return true;
      }
      break;

    case MessageType.ELEMENT_SELECTED:
      sendResponse({ received: true });
      break;

    case MessageType.NAVIGATE:
      if (payload?.url && sender.tab?.id) {
        handleNavigate(sender.tab.id, payload.url, sendResponse);
        return true;
      }
      break;

    case MessageType.GO_BACK:
      if (sender.tab?.id) {
        handleGoBack(sender.tab.id, sendResponse);
        return true;
      }
      break;

    case MessageType.GO_FORWARD:
      if (sender.tab?.id) {
        handleGoForward(sender.tab.id, sendResponse);
        return true;
      }
      break;

    case MessageType.GET_COOKIES:
      if (sender.tab?.id) {
        handleGetCookies(sender.tab.id, payload?.url, sendResponse);
        return true;
      }
      break;

    case MessageType.SET_COOKIE:
      if (sender.tab?.id) {
        handleSetCookie(sender.tab.id, payload, sendResponse);
        return true;
      }
      break;

    default:
      break;
  }
});

async function handleCaptureScreenshot(sendResponse: (response: unknown) => void) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !tab.windowId) {
      sendResponse({ error: 'No active tab found' });
      return;
    }

    const screenshot = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: 'png',
      quality: 100,
    });

    sendResponse({ screenshot });
  } catch (error) {
    sendResponse({ error: (error as Error).message });
  }
}

async function handleGetPageHTML(tabId: number, sendResponse: (response: unknown) => void) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return {
          html: document.documentElement.outerHTML,
          title: document.title,
          url: window.location.href,
        };
      },
    });

    if (results && results[0]?.result) {
      sendResponse(results[0].result);
    } else {
      sendResponse({ error: 'Failed to get page HTML' });
    }
  } catch (error) {
    sendResponse({ error: (error as Error).message });
  }
}

async function handleNavigate(tabId: number, url: string, sendResponse: (response: unknown) => void) {
  try {
    await chrome.tabs.update(tabId, { url });
    await new Promise(resolve => setTimeout(resolve, 2000));
    sendResponse({ success: true, message: `Navigated to: ${url}` });
  } catch (error) {
    sendResponse({ success: false, error: (error as Error).message });
  }
}

async function handleGoBack(tabId: number, sendResponse: (response: unknown) => void) {
  try {
    await chrome.tabs.goBack(tabId);
    await new Promise(resolve => setTimeout(resolve, 1000));
    sendResponse({ success: true, message: 'Went back' });
  } catch (error) {
    sendResponse({ success: false, error: (error as Error).message });
  }
}

async function handleGoForward(tabId: number, sendResponse: (response: unknown) => void) {
  try {
    await chrome.tabs.goForward(tabId);
    await new Promise(resolve => setTimeout(resolve, 1000));
    sendResponse({ success: true, message: 'Went forward' });
  } catch (error) {
    sendResponse({ success: false, error: (error as Error).message });
  }
}

async function handleGetCookies(tabId: number, url: string | undefined, sendResponse: (response: unknown) => void) {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    const targetUrl = url || tab?.url;
    
    if (!targetUrl) {
      sendResponse({ success: false, error: 'No URL available' });
      return;
    }

    const cookies = await chrome.cookies.getAll({ url: targetUrl });
    sendResponse({ success: true, cookies });
  } catch (error) {
    sendResponse({ success: false, error: (error as Error).message });
  }
}

async function handleSetCookie(tabId: number, payload: unknown, sendResponse: (response: unknown) => void) {
  try {
    const { name, value, url, domain, path, expirationDate, secure, httpOnly } = payload as {
      name: string;
      value: string;
      url?: string;
      domain?: string;
      path?: string;
      expirationDate?: number;
      secure?: boolean;
      httpOnly?: boolean;
    };

    if (!name || value === undefined) {
      sendResponse({ success: false, error: 'Name and value are required' });
      return;
    }

    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    const targetUrl = url || tab?.url;
    
    if (!targetUrl) {
      sendResponse({ success: false, error: 'No URL available' });
      return;
    }

    const cookieDetails: chrome.cookies.SetDetails = {
      url: targetUrl,
      name,
      value: String(value),
    };

    if (domain) cookieDetails.domain = domain;
    if (path) cookieDetails.path = path;
    if (expirationDate) cookieDetails.expirationDate = expirationDate;
    if (secure !== undefined) cookieDetails.secure = secure;
    if (httpOnly !== undefined) cookieDetails.httpOnly = httpOnly;

    await chrome.cookies.set(cookieDetails);
    sendResponse({ success: true, message: `Cookie set: ${name}=${value}` });
  } catch (error) {
    sendResponse({ success: false, error: (error as Error).message });
  }
}

