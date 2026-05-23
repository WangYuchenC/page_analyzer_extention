import { MessageType } from '~types';
import type { ElementInfo, NetworkRequest, NetworkResponse } from '~types';

class DebuggerManager {
  private attachedTabs = new Set<number>();
  private networkRequests = new Map<string, NetworkRequest>();
  private networkResponses = new Map<string, NetworkResponse>();

  async attach(tabId: number): Promise<void> {
    if (this.attachedTabs.has(tabId)) {
      return;
    }

    try {
      await chrome.debugger.attach({ tabId }, '1.3');
      this.attachedTabs.add(tabId);

      await chrome.debugger.sendCommand({ tabId }, 'Network.enable');
      await chrome.debugger.sendCommand({ tabId }, 'Debugger.enable');

      chrome.debugger.onEvent.addListener(this.handleDebuggerEvent.bind(this));
      chrome.debugger.onDetach.addListener(this.handleDetach.bind(this));

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
      this.networkRequests.clear();
      this.networkResponses.clear();
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
    if (!tabId) return;

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
        this.networkRequests.set(requestParams.requestId, request);

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
        this.networkResponses.set(responseParams.requestId, response);

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

      const response = this.networkResponses.get(requestId);
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
    }
  };

  isAttached(tabId: number): boolean {
    return this.attachedTabs.has(tabId);
  }

  getNetworkRequests(): NetworkRequest[] {
    return Array.from(this.networkRequests.values());
  }

  getNetworkResponses(): NetworkResponse[] {
    return Array.from(this.networkResponses.values());
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

    case MessageType.GET_PAGE_INFO:
      if (sender.tab?.id) {
        handleGetPageInfo(sender.tab.id, sendResponse);
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

async function handleGetPageInfo(tabId: number, sendResponse: (response: unknown) => void) {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        return {
          url: window.location.href,
          title: document.title,
          description: document.querySelector('meta[name="description"]')?.getAttribute('content') || '',
          keywords: document.querySelector('meta[name="keywords"]')?.getAttribute('content') || '',
        };
      },
    });

    if (results && results[0]?.result) {
      sendResponse(results[0].result);
    } else {
      sendResponse({ error: 'Failed to get page info' });
    }
  } catch (error) {
    sendResponse({ error: (error as Error).message });
  }
}
