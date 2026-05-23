# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm dev       # Development mode with hot-reload (load build/chrome-mv3-dev in Chrome)
pnpm build     # Production build (output to build/chrome-mv3-prod)
pnpm package   # Build + create zip archive for Chrome Web Store submission
```

## Project Overview

**Page Analyzer** — a Chrome extension (Manifest V3) built with [Plasmo](https://docs.plasmo.com/) framework. It helps users analyze web page structures and generate web scraping code via LLM conversation.

## Entry Points (auto-detected by Plasmo from `src/`)

| File | Type | Purpose |
|------|------|---------|
| `src/background.ts` | Service Worker | Message router, Chrome Debugger API (CDP) manager, screenshot/HTML capture |
| `src/content.ts` | Content Script | DOM element picker, CSS selector / full-text search / page summary extraction |
| `src/sidepanel.tsx` | Side Panel | Main React UI (Chat + Network tabs), LLM streaming chat with tool calling |

`popup.tsx` was intentionally removed — clicking the extension icon triggers `chrome.action.onClicked` (in background.ts) to open the side panel directly.

## Architecture: Message Passing

The extension uses a hub-and-spoke messaging model:

```
sidepanel.tsx ←→ background.ts ←→ content.ts
                    ↕
            Chrome Debugger API (CDP)
```

- `background.ts` acts as a central hub: routes messages between the side panel and content script, manages debugger lifecycle, captures screenshots
- `content.ts` runs in-page, handles element picker (`ELEMENT_HIGHLIGHT`), DOM querying (`QUERY_SELECTOR`), full-text search (`SEARCH_PAGE`), page summary extraction (`GET_PAGE_SUMMARY`), and selected element retrieval (`GET_SELECTED_ELEMENT`)
- `sidepanel.tsx` initiates actions, listens for results, manages LLM streaming chat with tool calling loop

All message types are defined in `src/types/index.ts` as the `MessageType` enum. Use `sendMessage()` / `addMessageListener()` from `src/utils/messaging.ts` for type-safe communication.

## Source Modules

- `src/types/index.ts` — `ElementInfo`, `NetworkRequest`, `NetworkResponse`, `ChatMessage`, `ToolCall`, `PageSummary`, `StreamChunk`, `MessageType` enum
- `src/store/app-store.ts` — Zustand store with `persist` middleware (persists `apiKey`, `baseUrl`, `model` to `chrome.storage` under key `page-analyzer-storage`); store methods include `updateMessage`, `appendToMessage`, `setMessageStreaming` for streaming support
- `src/utils/messaging.ts` — `sendMessage()`, `sendMessageToTab()`, `addMessageListener()` — typed wrappers around `chrome.runtime` APIs
- `src/utils/streaming.ts` — `streamChatCompletion()` — SSE stream parser using `response.body.getReader()` + `TextDecoder`; yields `StreamChunk` objects
- `src/utils/tools.ts` — `TOOL_DEFINITIONS` (4 tool schemas), `accumulateToolCallDeltas()`, `getToolCallArgs()`, `buildSystemPrompt()` — tool calling infrastructure

## Key Patterns

- **Import alias**: `~` maps to `./src/` (e.g., `import { MessageType } from '~types'` resolves to `src/types/index.ts`)
- **State management**: Zustand single store. `apiKey`, `baseUrl`, and `model` persist to `chrome.storage`; all other state (messages, page summary, network data) is in-memory only
- **LLM integration**: Uses native `fetch()` with SSE streaming to call OpenAI-compatible REST API (`/chat/completions`). No SDK dependency. Supports custom base URL and model name. Supports tool/function calling and multi-turn conversation history.
- **Tool calling loop**: sidepanel.tsx accumulates `tool_call` deltas during streaming, executes tools via content script messaging, then makes a follow-up streaming call with tool results — all within a single user message flow
- **Page context**: Structured `PageSummary` (URL, title, headings, text preview, link/image counts) auto-fetched on mount, replaces raw HTML truncation in LLM context
- **Streaming UI**: Real-time token display with blinking cursor, status bar, stop button (AbortController), error retry button, tool call visualization panel
- **Debugger**: `DebuggerManager` class wraps `chrome.debugger` API, listens for `Network.requestWillBeSent` and `Network.responseReceived` events, fetches response bodies via `Network.getResponseBody`
- **DOM Picker**: `ElementPicker` creates a full-screen transparent overlay, listens for mouse events, extracts `XPath`, `cssSelector`, `attributes`, `rect`, etc.
- **Side panel entry**: Clicking the extension icon triggers `chrome.action.onClicked` in background.ts, which calls `chrome.sidePanel.open()` to open the side panel

## Configuration

- **TailwindCSS**: `tailwind.config.js` with custom `primary` color palette and custom `blink` animation
- **PostCSS**: `postcss.config.js` with `tailwindcss` + `autoprefixer` plugins
- **Prettier**: `.prettierrc.mjs` with `@ianvs/prettier-plugin-sort-imports` and grouped import ordering
- **CI/CD**: `.github/workflows/submit.yml` — manual workflow that builds and publishes to Chrome Web Store via `PlasmoHQ/bpp`

## Loading in Chrome (after build)

Load the `build/chrome-mv3-prod` directory via `chrome://extensions` → "Load unpacked". The source directory itself has no `manifest.json` — it is generated by Plasmo during build.
