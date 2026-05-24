import { MessageType, type Message } from '~types';
import { debugLog, errorLog, infoLog } from './logger';

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String((error as Record<string, unknown>).message);
  }
  return String(error);
}

export function sendMessage<T = unknown, R = unknown>(
  type: MessageType,
  payload: T
): Promise<R> {
  debugLog('Messaging', 'Sending message:', type, payload);

  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage<Message<T>, R>(
      { type, payload },
      (response) => {
        if (chrome.runtime.lastError) {
          const errorMsg = getErrorMessage(chrome.runtime.lastError);
          errorLog('Messaging', 'Send message error:', type, errorMsg);
          reject(new Error(errorMsg));
        } else {
          debugLog('Messaging', 'Message response received:', type, response);
          resolve(response);
        }
      }
    );
  });
}

export function sendMessageToTab<T = unknown, R = unknown>(
  tabId: number,
  type: MessageType,
  payload: T
): Promise<R> {
  debugLog('Messaging', 'Sending message to tab:', tabId, type, payload);

  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage<Message<T>, R>(
      tabId,
      { type, payload },
      (response) => {
        if (chrome.runtime.lastError) {
          const errorMsg = getErrorMessage(chrome.runtime.lastError);
          errorLog('Messaging', 'Send message to tab error:', tabId, type, errorMsg);
          reject(new Error(errorMsg));
        } else {
          debugLog('Messaging', 'Tab message response received:', tabId, type, response);
          resolve(response);
        }
      }
    );
  });
}

export async function sendToContentScript<T = unknown>(
  tabId: number,
  message: { type: MessageType; payload?: unknown }
): Promise<T> {
  debugLog('Messaging', 'sendToContentScript:', tabId, message.type, message.payload);

  try {
    const response = await chrome.tabs.sendMessage(tabId, message);
    debugLog('Messaging', 'sendToContentScript response:', tabId, message.type, response);
    return response;
  } catch (_error) {
    debugLog('Messaging', 'Content script not ready, injecting...', tabId);
    const jsFiles = chrome.runtime.getManifest().content_scripts?.[0]?.js;
    if (jsFiles) {
      await chrome.scripting.executeScript({ target: { tabId }, files: jsFiles });
      debugLog('Messaging', 'Content script injected, waiting for initialization...');
      // Wait for content script to initialize and register its listener
      await new Promise(r => setTimeout(r, 300));
    }
    const response = await chrome.tabs.sendMessage(tabId, message);
    debugLog('Messaging', 'sendToContentScript response after injection:', tabId, message.type, response);
    return response;
  }
}

export function addMessageListener<T = unknown>(
  type: MessageType,
  handler: (payload: T, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => void | Promise<unknown>
) {
  debugLog('Messaging', 'Adding message listener for:', type);

  const listener = (
    message: Message<T>,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ) => {
    if (message.type === type) {
      debugLog('Messaging', 'Message received:', type, message.payload, 'from:', sender.tab?.id);
      const result = handler(message.payload, sender, sendResponse);
      if (result instanceof Promise) {
        result.then((response) => {
          debugLog('Messaging', 'Handler resolved:', type, response);
          sendResponse(response);
        }).catch((error) => {
          errorLog('Messaging', 'Message handler error:', type, error);
          sendResponse({ error: error.message });
        });
        return true;
      }
    }
  };

  chrome.runtime.onMessage.addListener(listener);
  infoLog('Messaging', 'Message listener registered for:', type);

  return () => {
    debugLog('Messaging', 'Removing message listener for:', type);
    chrome.runtime.onMessage.removeListener(listener);
  };
}
