import { MessageType, type Message } from '~types';

export function sendMessage<T = unknown, R = unknown>(
  type: MessageType,
  payload: T
): Promise<R> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage<Message<T>, R>(
      { type, payload },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
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
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage<Message<T>, R>(
      tabId,
      { type, payload },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
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
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    const jsFiles = chrome.runtime.getManifest().content_scripts?.[0]?.js;
    if (jsFiles) {
      await chrome.scripting.executeScript({ target: { tabId }, files: jsFiles });
    }
    return await chrome.tabs.sendMessage(tabId, message);
  }
}

export function addMessageListener<T = unknown>(
  type: MessageType,
  handler: (payload: T, sender: chrome.runtime.MessageSender, sendResponse: (response?: unknown) => void) => void | Promise<unknown>
) {
  const listener = (
    message: Message<T>,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void
  ) => {
    if (message.type === type) {
      const result = handler(message.payload, sender, sendResponse);
      if (result instanceof Promise) {
        result.then(sendResponse).catch((error) => {
          console.error('Message handler error:', error);
          sendResponse({ error: error.message });
        });
        return true;
      }
    }
  };

  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}
