import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import type { ChatMessage, ChatSession, ElementInfo, NetworkRequest, NetworkResponse, PageSummary } from '~types';
import { encrypt, decrypt } from '~utils/crypto';

interface AppState {
  // Sessions
  sessions: ChatSession[];
  currentSessionId: string | null;
  createSession: (title?: string, pageUrl?: string) => string;
  switchSession: (sessionId: string) => void;
  deleteSession: (sessionId: string) => void;
  updateSessionTitle: (sessionId: string, title: string) => void;

  // Chat (current session)
  messages: ChatMessage[];
  addMessage: (message: ChatMessage) => void;
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void;
  appendToMessage: (id: string, chunk: string) => void;
  setMessageStreaming: (id: string, isStreaming: boolean) => void;
  clearMessages: () => void;

  // Session-scoped chat operations (for race-condition-safe async writes)
  addMessageToSession: (sessionId: string, message: ChatMessage) => void;
  updateMessageInSession: (sessionId: string, id: string, updates: Partial<ChatMessage>) => void;
  appendToMessageInSession: (sessionId: string, id: string, chunk: string) => void;
  setMessageStreamingInSession: (sessionId: string, id: string, isStreaming: boolean) => void;

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

interface PersistedState {
  apiKey: string;
  baseUrl: string;
  model: string;
  temperature: number;
  sessions: ChatSession[];
  currentSessionId: string | null;
}

const encryptedStorage: PersistStorage<AppState> = {
  getItem: async (name: string): Promise<StorageValue<AppState> | null> => {
    const result = await chrome.storage.local.get(name);
    const value = result[name];
    if (!value) return null;
    try {
      const clonedValue = JSON.parse(JSON.stringify(value)) as StorageValue<AppState>;
      if (clonedValue.state?.apiKey) {
        clonedValue.state.apiKey = await decrypt(clonedValue.state.apiKey);
      }
      return clonedValue;
    } catch {
      return value as StorageValue<AppState>;
    }
  },
  setItem: async (name: string, value: StorageValue<AppState>) => {
    const clonedValue = JSON.parse(JSON.stringify(value)) as { state: PersistedState };
    if (clonedValue.state?.apiKey) {
      clonedValue.state.apiKey = await encrypt(clonedValue.state.apiKey);
    }
    await chrome.storage.local.set({ [name]: clonedValue });
  },
  removeItem: async (name: string) => {
    await chrome.storage.local.remove(name);
  },
};

function generateSessionId(): string {
  return `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function getDefaultTitle(messages: ChatMessage[]): string {
  const firstUserMsg = messages.find(m => m.role === 'user');
  if (firstUserMsg) {
    return firstUserMsg.content.slice(0, 30) + (firstUserMsg.content.length > 30 ? '...' : '');
  }
  return '未命名会话';
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Sessions
      sessions: [],
      currentSessionId: null,

      createSession: (title?: string, pageUrl?: string) => {
        const newSession: ChatSession = {
          id: generateSessionId(),
          title: title || '新会话',
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          pageUrl,
        };
        set((state) => ({
          sessions: [...state.sessions, newSession],
          currentSessionId: newSession.id,
        }));
        return newSession.id;
      },

      switchSession: (sessionId) => {
        set({ currentSessionId: sessionId });
      },

      deleteSession: (sessionId) => {
        set((state) => {
          const newSessions = state.sessions.filter(s => s.id !== sessionId);
          const newCurrentId = state.currentSessionId === sessionId
            ? newSessions.length > 0 ? newSessions[newSessions.length - 1].id : null
            : state.currentSessionId;
          return {
            sessions: newSessions,
            currentSessionId: newCurrentId,
          };
        });
      },

      updateSessionTitle: (sessionId, title) => {
        set((state) => ({
          sessions: state.sessions.map(s =>
            s.id === sessionId ? { ...s, title } : s
          ),
        }));
      },

      // Chat (current session)
      messages: [],

      addMessage: (message) => {
        const sessionId = get().currentSessionId;
        if (sessionId) get().addMessageToSession(sessionId, message);
      },

      addMessageToSession: (sessionId, message) => {
        set((state) => {
          if (state.currentSessionId !== sessionId) return state;
          const sessionIndex = state.sessions.findIndex(s => s.id === sessionId);
          if (sessionIndex === -1) return state;
          const sessions = [...state.sessions];
          sessions[sessionIndex] = {
            ...sessions[sessionIndex],
            messages: [...sessions[sessionIndex].messages, message].slice(-100),
            updatedAt: Date.now(),
          };
          // Auto-update title if it's still default
          if (sessions[sessionIndex].title === '新会话' || sessions[sessionIndex].title === '未命名会话') {
            sessions[sessionIndex].title = getDefaultTitle(sessions[sessionIndex].messages);
          }
          return { sessions };
        });
      },

      updateMessage: (id, updates) => {
        const sessionId = get().currentSessionId;
        if (sessionId) get().updateMessageInSession(sessionId, id, updates);
      },

      updateMessageInSession: (sessionId, id, updates) => {
        set((state) => {
          if (state.currentSessionId !== sessionId) return state;
          const sessionIndex = state.sessions.findIndex(s => s.id === sessionId);
          if (sessionIndex === -1) return state;
          const sessions = [...state.sessions];
          sessions[sessionIndex] = {
            ...sessions[sessionIndex],
            messages: sessions[sessionIndex].messages.map(m =>
              m.id === id ? { ...m, ...updates } : m
            ),
            updatedAt: Date.now(),
          };
          return { sessions };
        });
      },

      appendToMessage: (id, chunk) => {
        const sessionId = get().currentSessionId;
        if (sessionId) get().appendToMessageInSession(sessionId, id, chunk);
      },

      appendToMessageInSession: (sessionId, id, chunk) => {
        set((state) => {
          if (state.currentSessionId !== sessionId) return state;
          const sessionIndex = state.sessions.findIndex(s => s.id === sessionId);
          if (sessionIndex === -1) return state;
          const sessions = [...state.sessions];
          sessions[sessionIndex] = {
            ...sessions[sessionIndex],
            messages: sessions[sessionIndex].messages.map(m =>
              m.id === id ? { ...m, content: m.content + chunk } : m
            ),
            updatedAt: Date.now(),
          };
          return { sessions };
        });
      },

      setMessageStreaming: (id, isStreaming) => {
        const sessionId = get().currentSessionId;
        if (sessionId) get().setMessageStreamingInSession(sessionId, id, isStreaming);
      },

      setMessageStreamingInSession: (sessionId, id, isStreaming) => {
        set((state) => {
          if (state.currentSessionId !== sessionId) return state;
          const sessionIndex = state.sessions.findIndex(s => s.id === sessionId);
          if (sessionIndex === -1) return state;
          const sessions = [...state.sessions];
          sessions[sessionIndex] = {
            ...sessions[sessionIndex],
            messages: sessions[sessionIndex].messages.map(m =>
              m.id === id ? { ...m, isStreaming } : m
            ),
          };
          return { sessions };
        });
      },

      clearMessages: () => {
        set((state) => {
          const sessionIndex = state.sessions.findIndex(s => s.id === state.currentSessionId);
          if (sessionIndex === -1) return state;
          const sessions = [...state.sessions];
          sessions[sessionIndex] = {
            ...sessions[sessionIndex],
            messages: [],
            title: '新会话',
            updatedAt: Date.now(),
          };
          return { sessions };
        });
      },

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
        sessions: state.sessions,
        currentSessionId: state.currentSessionId,
      }),
    }
  )
);

export function useCurrentSessionMessages() {
  const sessions = useAppStore(state => state.sessions);
  const currentSessionId = useAppStore(state => state.currentSessionId);
  
  const currentSession = sessions.find(s => s.id === currentSessionId);
  return currentSession?.messages || [];
}