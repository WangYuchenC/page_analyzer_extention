import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ChatMessage, ElementInfo, NetworkRequest, NetworkResponse } from '~types';

interface AppState {
  // Chat
  messages: ChatMessage[];
  addMessage: (message: ChatMessage) => void;
  clearMessages: () => void;
  
  // Element
  selectedElement: ElementInfo | null;
  setSelectedElement: (element: ElementInfo | null) => void;
  
  // Page Data
  screenshot: string | null;
  setScreenshot: (screenshot: string | null) => void;
  pageHtml: string | null;
  setPageHtml: (html: string | null) => void;
  
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
      clearMessages: () => set({ messages: [] }),
      
      // Element
      selectedElement: null,
      setSelectedElement: (element) => set({ selectedElement: element }),
      
      // Page Data
      screenshot: null,
      setScreenshot: (screenshot) => set({ screenshot }),
      pageHtml: null,
      setPageHtml: (html) => set({ pageHtml: html }),
      
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
