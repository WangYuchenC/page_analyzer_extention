import { create } from 'zustand';
import { persist, type StateStorage } from 'zustand/middleware';
import type { ChatMessage, ElementInfo, NetworkRequest, NetworkResponse, PageSummary } from '~types';
import { encrypt, decrypt } from '~utils/crypto';

interface AppState {
  // Chat
  messages: ChatMessage[];
  addMessage: (message: ChatMessage) => void;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  appendToMessage: (id: string, chunk: string) => void;
  setMessageStreaming: (id: string, isStreaming: boolean) => void;
  clearMessages: () => void;

  // Element
  selectedElement: ElementInfo | null;
  setSelectedElement: (element: ElementInfo | null) => void;

  // Page Data
  screenshot: string | null;
  setScreenshot: (screenshot: string | null) => void;
  pageSummary: PageSummary | null;
  setPageSummary: (summary: PageSummary | null) => void;

  // Network
  networkRequests: NetworkRequest[];
  addNetworkRequest: (request: NetworkRequest) => void;
  networkResponses: NetworkResponse[];
  addNetworkResponse: (response: NetworkResponse) => void;
  clearNetworkData: () => void;

  // Settings
  apiKey: string;
  setApiKey: (key: string) => void;
  baseUrl: string;
  setBaseUrl: (url: string) => void;
  model: string;
  setModel: (model: string) => void;
  temperature: number;
  setTemperature: (temp: number) => void;
}

const encryptedStorage: StateStorage = {
  getItem: async (name: string) => {
    const result = await chrome.storage.local.get(name);
    const value = result[name];
    if (!value) return null;
    try {
      if (value.state?.apiKey) {
        value.state.apiKey = await decrypt(value.state.apiKey);
      }
    } catch {
      // decryption failed — may be legacy plaintext
    }
    return JSON.stringify(value);
  },
  setItem: async (name: string, value: string) => {
    const parsed = JSON.parse(value);
    if (parsed.state?.apiKey) {
      parsed.state.apiKey = await encrypt(parsed.state.apiKey);
    }
    await chrome.storage.local.set({ [name]: parsed });
  },
  removeItem: async (name: string) => {
    await chrome.storage.local.remove(name);
  },
};

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // Chat
      messages: [],
      addMessage: (message) => set((state) => ({
        messages: [...state.messages, message].slice(-100)
      })),
      updateMessage: (id, updates) => set((state) => ({
        messages: state.messages.map((m) =>
          m.id === id ? { ...m, ...updates } : m
        )
      })),
      appendToMessage: (id, chunk) => set((state) => ({
        messages: state.messages.map((m) =>
          m.id === id ? { ...m, content: m.content + chunk } : m
        )
      })),
      setMessageStreaming: (id, isStreaming) => set((state) => ({
        messages: state.messages.map((m) =>
          m.id === id ? { ...m, isStreaming } : m
        )
      })),
      clearMessages: () => set({ messages: [] }),

      // Element
      selectedElement: null,
      setSelectedElement: (element) => set({ selectedElement: element }),

      // Page Data
      screenshot: null,
      setScreenshot: (screenshot) => set({ screenshot }),
      pageSummary: null,
      setPageSummary: (summary) => set({ pageSummary: summary }),

      // Network
      networkRequests: [],
      addNetworkRequest: (request) => set((state) => ({
        networkRequests: [...state.networkRequests.slice(-99), request]
      })),
      networkResponses: [],
      addNetworkResponse: (response) => set((state) => ({
        networkResponses: [...state.networkResponses.filter(r => r.requestId !== response.requestId).slice(-99), response]
      })),
      clearNetworkData: () => set({ networkRequests: [], networkResponses: [] }),

      // Settings
      apiKey: '',
      setApiKey: (key) => set({ apiKey: key }),
      baseUrl: '',
      setBaseUrl: (url) => set({ baseUrl: url }),
      model: 'gpt-4o-mini',
      setModel: (model) => set({ model: model }),
      temperature: 0,
      setTemperature: (temp) => set({ temperature: temp }),
    }),
    {
      name: 'page-analyzer-storage',
      storage: encryptedStorage,
      partialize: (state) => ({
        apiKey: state.apiKey,
        baseUrl: state.baseUrl,
        model: state.model,
        temperature: state.temperature,
      }),
    }
  )
);
