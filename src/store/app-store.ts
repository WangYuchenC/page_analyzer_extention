import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ChatMessage, ElementInfo, NetworkRequest, NetworkResponse, PageSummary } from '~types';

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
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      // Chat
      messages: [],
      addMessage: (message) => set((state) => ({
        messages: [...state.messages, message]
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
    }),
    {
      name: 'page-analyzer-storage',
      partialize: (state) => ({
        apiKey: state.apiKey,
        baseUrl: state.baseUrl,
        model: state.model,
      }),
    }
  )
);
