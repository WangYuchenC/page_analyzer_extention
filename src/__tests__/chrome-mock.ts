import { vi } from "vitest"

export function createChromeMock() {
  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {}

  const chromeMock = {
    runtime: {
      sendMessage: vi.fn(),
      onMessage: {
        addListener: vi.fn((listener: (...args: unknown[]) => void) => {
          listeners["onMessage"] = listeners["onMessage"] || []
          listeners["onMessage"].push(listener)
        }),
        removeListener: vi.fn(),
      },
      lastError: null,
      getManifest: vi.fn(() => ({
        content_scripts: [{ js: ["content.js"] }],
      })),
    },
    tabs: {
      sendMessage: vi.fn(),
      query: vi.fn(),
      update: vi.fn(),
      goBack: vi.fn(),
      goForward: vi.fn(),
      get: vi.fn(),
      onUpdated: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
      onRemoved: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
    scripting: {
      executeScript: vi.fn(),
    },
    debugger: {
      attach: vi.fn(),
      detach: vi.fn(),
      sendCommand: vi.fn(),
      onEvent: { addListener: vi.fn() },
      onDetach: { addListener: vi.fn() },
    },
    cookies: {
      getAll: vi.fn(),
      set: vi.fn(),
    },
    sidePanel: {
      open: vi.fn(),
    },
    action: {
      onClicked: {
        addListener: vi.fn(),
      },
    },
    storage: {
      local: {
        get: vi.fn(),
        set: vi.fn(),
        remove: vi.fn(),
      },
      sync: {
        get: vi.fn(),
        set: vi.fn(),
      },
    },
    // Helper to trigger events in tests
    __trigger: (event: string, ...args: unknown[]) => {
      if (listeners[event]) {
        listeners[event].forEach((l) => l(...args))
      }
    },
  }

  return chromeMock
}

// Singleton mock for easy setup in tests
export const mockChrome = createChromeMock()

export function setupChromeMock() {
  const chrome = mockChrome as unknown as typeof chrome
  vi.stubGlobal("chrome", chrome)
  return chrome
}

export function teardownChromeMock() {
  vi.unstubAllGlobals()
}
