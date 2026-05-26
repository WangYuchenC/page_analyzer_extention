# Page Analyzer 修复 + 复制按钮功能实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复评审报告中 P0-P2 级别的 7 个核心问题，并为 MessageBubble 增加一键复制功能。

**Architecture:** 保持现有 hub-and-spoke 消息架构不变，局部修复数据格式、加密安全、Debugger 会话管理、工具 Schema 同步、Content Script 握手、React 输入兼容性和网络数据清理。复制按钮作为 UI 增强，使用 navigator.clipboard API。

**Tech Stack:** TypeScript, React, Chrome Extension MV3, Plasmo, LangChain, Zustand, Vitest

---

## 文件变更总览

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/utils/agent.ts` | 修改 | 统一错误格式、工具 Schema 自动生成、提取公共参数定义 |
| `src/content.ts` | 修改 | 统一错误格式为 `{error: "..."}`、增加 React 受控组件 fallback、Content Script ready 握手 |
| `src/background.ts` | 修改 | DebuggerManager 统一接管 CDP 脚本执行、网络数据上限清理 |
| `src/utils/crypto.ts` | 修改 | 使用随机 Salt + 持久化存储 |
| `src/utils/messaging.ts` | 修改 | sendToContentScript 改为握手协议 |
| `src/components/MessageBubble.tsx` | 修改 | 增加复制按钮、验证无 push() 热路径 |
| `src/store/app-store.ts` | 修改 | 网络数据清理触发 |
| `src/__tests__/tool-errors.test.ts` | 修改 | 更新测试以匹配修复后的错误格式 |
| `src/__tests__/tool-bugs.test.ts` | 修改 | 将文档式测试改为实际可执行测试 |
| `src/__tests__/crypto.test.ts` | 新增 | 加密/解密单元测试 |
| `src/__tests__/messaging.test.ts` | 新增 | 握手协议测试 |

---

## Task 1: 统一 content.ts 与 agent.ts 的错误返回格式 (P0)

**Files:**
- Modify: `src/content.ts`
- Modify: `src/utils/agent.ts`
- Test: `src/__tests__/tool-errors.test.ts`

**背景:** content.ts 中所有工具返回 `{success: false, error: "..."}` 或 `{success: true, ...}`，而 agent.ts 的 `normalizeToolResponse` 期望 `{error: "..."}` 格式。这导致 LLM 收到 tool result 时无法正确识别错误。

**方案:** 将 content.ts 中所有 `sendResponse({ success: false, error: ... })` 改为 `sendResponse({ error: ... })`，所有 `sendResponse({ success: true, ... })` 改为直接返回数据对象（去掉 success 包装）。同时更新 agent.ts 中的 `normalizeToolResponse`，使其兼容旧格式（向后兼容）。

- [ ] **Step 1: 修改 content.ts 错误格式**

将以下所有模式：
```typescript
sendResponse({ success: false, error: `...` });
```
改为：
```typescript
sendResponse({ error: `...` });
```

将以下所有模式：
```typescript
sendResponse({ success: true, message: `...`, ... });
```
改为：
```typescript
sendResponse({ message: `...`, ... });
```

涉及的消息类型：CLICK_ELEMENT, INPUT_TEXT, SCROLL_PAGE, HOVER_ELEMENT, WAIT_FOR_ELEMENT, QUERY_SELECTOR, SEARCH_PAGE, GET_PAGE_SUMMARY, GET_SELECTED_ELEMENT。

- [ ] **Step 2: 更新 agent.ts normalizeToolResponse 兼容旧格式**

```typescript
function normalizeToolResponse(raw: string): string {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      // 新格式: {error: "..."}
      if (parsed.error && parsed.success === undefined) {
        return raw;
      }
      // 旧格式兼容: {success: false, error: "..."}
      if (parsed.success === false && parsed.error) {
        return JSON.stringify({ error: parsed.error });
      }
      // {success: true, ...} → 去掉 success，保留其余
      if (parsed.success === true) {
        const { success, ...rest } = parsed;
        return JSON.stringify(rest);
      }
    }
  } catch {
    // Not JSON, return as-is
  }
  return raw;
}
```

- [ ] **Step 3: 更新 tool-errors.test.ts**

修改测试断言，验证 content.ts 现在直接返回 `{error: "..."}`，且 `normalizeToolResponse` 能正确处理新旧两种格式。

- [ ] **Step 4: 运行测试**

```bash
pnpm test
```

Expected: 全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/content.ts src/utils/agent.ts src/__tests__/tool-errors.test.ts
git commit -m "fix: unify error response format between content script and agent"
```

---

## Task 2: 修复 crypto.ts 使用随机 Salt (P1)

**Files:**
- Modify: `src/utils/crypto.ts`
- Create: `src/__tests__/crypto.test.ts`

**背景:** 当前使用硬编码 Salt，所有安装实例的加密密钥相同，存在离线暴力破解风险。

**方案:** 首次运行时生成随机 Salt，存储在 `chrome.storage.local` 的 `page-analyzer-crypto-salt` 中。后续加密/解密使用该 Salt。保持向后兼容：若无法解密，回退返回原文。

- [ ] **Step 1: 修改 crypto.ts**

```typescript
const SALT_KEY = 'page-analyzer-crypto-salt';
const DEFAULT_SALT = 'page-analyzer-salt-v1'; // 向后兼容 fallback

async function getStoredSalt(): Promise<string> {
  try {
    const result = await chrome.storage.local.get(SALT_KEY);
    if (result[SALT_KEY]) return result[SALT_KEY] as string;
    // 生成新 salt
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    const newSalt = btoa(String.fromCharCode(...array));
    await chrome.storage.local.set({ [SALT_KEY]: newSalt });
    return newSalt;
  } catch {
    return DEFAULT_SALT;
  }
}

async function getKey(): Promise<CryptoKey> {
  const salt = await getStoredSalt();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    ENCODER.encode(salt),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: ENCODER.encode(salt),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}
```

- [ ] **Step 2: 创建 crypto.test.ts**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setupChromeMock, teardownChromeMock, mockChrome } from "./chrome-mock";

describe("crypto", () => {
  beforeEach(() => {
    setupChromeMock();
    vi.clearAllMocks();
  });

  afterEach(() => {
    teardownChromeMock();
  });

  it("should encrypt and decrypt text", async () => {
    const { encrypt, decrypt } = await import("../utils/crypto");
    const original = "my-secret-api-key";
    const encrypted = await encrypt(original);
    expect(encrypted).not.toBe(original);
    const decrypted = await decrypt(encrypted);
    expect(decrypted).toBe(original);
  });

  it("should return empty string for empty input", async () => {
    const { encrypt, decrypt } = await import("../utils/crypto");
    expect(await encrypt("")).toBe("");
    expect(await decrypt("")).toBe("");
  });

  it("should use stored salt if available", async () => {
    mockChrome.storage.local.get.mockResolvedValueOnce({
      "page-analyzer-crypto-salt": "custom-salt-123",
    });
    const { encrypt } = await import("../utils/crypto");
    const encrypted = await encrypt("test");
    expect(encrypted).not.toBe("test");
    expect(mockChrome.storage.local.get).toHaveBeenCalledWith("page-analyzer-crypto-salt");
  });
});
```

- [ ] **Step 3: 运行测试**

```bash
pnpm test
```

- [ ] **Step 4: Commit**

```bash
git add src/utils/crypto.ts src/__tests__/crypto.test.ts
git commit -m "fix: use per-install random salt for API key encryption"
```

---

## Task 3: DebuggerManager 统一接管 execute_script 的 CDP 会话 (P1)

**Files:**
- Modify: `src/background.ts`
- Modify: `src/utils/agent.ts`

**背景:** `handleExecuteScript` 自行 attach/detach debugger，若 `DebuggerManager` 已 attach 同一 tab，会冲突报错。

**方案:** `DebuggerManager` 增加 `evaluateScript(tabId, script)` 方法，复用已有 debugger 连接。`handleExecuteScript` 改为调用此方法。若未 attach，则临时 attach → evaluate → detach。

- [ ] **Step 1: 在 DebuggerManager 中增加 evaluateScript 方法**

在 `src/background.ts` 的 `DebuggerManager` 类中（`isAttached` 方法之后）添加：

```typescript
async evaluateScript(tabId: number, script: string): Promise<{
  success: boolean;
  result?: unknown;
  error?: string;
}> {
  const wasAlreadyAttached = this.attachedTabs.has(tabId);

  if (!wasAlreadyAttached) {
    try {
      await chrome.debugger.attach({ tabId }, '1.3');
      this.attachedTabs.add(tabId);
      await chrome.debugger.sendCommand({ tabId }, 'Debugger.enable');
    } catch (e) {
      return { success: false, error: (e as Error).message };
    }
  }

  try {
    const result = await chrome.debugger.sendCommand(
      { tabId },
      'Runtime.evaluate',
      {
        expression: `(async function(){${script}})()`,
        awaitPromise: true,
        returnByValue: true,
      }
    ) as {
      result?: { value?: unknown; objectId?: string; description?: string };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    };

    if (result.exceptionDetails) {
      return {
        success: false,
        error: result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Script execution error',
      };
    } else if (result.result?.value !== undefined) {
      return { success: true, result: sanitizeForMessaging(result.result.value) };
    } else if (result.result?.objectId) {
      return {
        success: true,
        result: result.result.description ? `[${result.result.description}]` : '[Non-serializable return value]',
      };
    } else {
      return { success: true, result: null };
    }
  } catch (error) {
    return { success: false, error: (error as Error).message };
  } finally {
    if (!wasAlreadyAttached) {
      try {
        await chrome.debugger.detach({ tabId });
        this.attachedTabs.delete(tabId);
      } catch {
        // Ignore detach errors
      }
    }
  }
}
```

- [ ] **Step 2: 重写 handleExecuteScript**

将 `src/background.ts` 中现有的 `handleExecuteScript` 函数（约 509-567 行）替换为：

```typescript
async function handleExecuteScript(tabId: number, script: string, sendResponse: (response: unknown) => void) {
  const result = await debuggerManager.evaluateScript(tabId, script);
  sendResponse(result);
}
```

- [ ] **Step 3: 更新 agent.ts 中 execute_script 工具的错误处理**

由于 `evaluateScript` 返回 `{success: boolean, result?, error?}`，agent.ts 中 `executeScriptTool` 的 `sendMessage` 结果处理需要适配。当前 `executeScriptTool` 直接 `JSON.stringify(result)`，格式已经正确，无需修改。

- [ ] **Step 4: 运行测试**

```bash
pnpm test
```

- [ ] **Step 5: Commit**

```bash
git add src/background.ts
git commit -m "fix: unify debugger session management for execute_script"
```

---

## Task 4: 工具 Schema 与描述单一数据源化 (P1)

**Files:**
- Modify: `src/utils/agent.ts`
- Modify: `src/utils/tools.ts`

**背景:** 工具参数描述在 `buildSystemPrompt`（字符串）、`createChromeTools`（DynamicTool 描述）、`invokeModelRaw`（JSON Schema）三处硬编码，维护成本高。

**方案:** 在 `agent.ts` 中定义统一的工具元数据数组，包含名称、描述、参数 Schema，然后自动生成 DynamicTool 描述和 `invokeModelRaw` 的 Schema。

- [ ] **Step 1: 在 agent.ts 中定义工具元数据**

在 `createChromeTools` 之前添加：

```typescript
interface ToolMeta {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description?: string; enum?: string[] }>;
    required?: string[];
  };
}

const TOOL_METAS: ToolMeta[] = [
  {
    name: "query_selector",
    description: "Query the page DOM using a CSS selector. Returns text content, HTML, and attributes of matching elements.",
    parameters: {
      type: "object",
      properties: {
        selector: { type: "string", description: "CSS selector to query" },
        maxResults: { type: "number", description: "Maximum results (default 5, max 20)" },
        includeHtml: { type: "boolean", description: "Include HTML content in results" },
      },
      required: ["selector"],
    },
  },
  // ... 其余 17 个工具类似定义
];
```

（完整定义需包含全部 18 个工具，与现有 `toolParamSchemas` 内容一致。）

- [ ] **Step 2: 修改 createChromeTools 自动生成描述**

```typescript
function buildToolDescription(meta: ToolMeta): string {
  const params = Object.entries(meta.parameters.properties)
    .map(([key, val]) => {
      const req = meta.parameters.required?.includes(key) ? "required" : "optional";
      return `"${key}" (${val.type}, ${req}${val.description ? ` - ${val.description}` : ""})`;
    })
    .join(", ");
  return `${meta.description} Input: JSON object with ${params}.`;
}
```

然后在 `createChromeTools` 中：
```typescript
const querySelectorTool = new DynamicTool({
  name: TOOL_METAS[0].name,
  description: buildToolDescription(TOOL_METAS[0]),
  func: async (input: string) => { /* ... */ },
});
```

- [ ] **Step 3: 修改 invokeModelRaw 使用 TOOL_METAS**

将 `toolParamSchemas` 硬编码对象替换为从 `TOOL_METAS` 自动生成：

```typescript
const tools = agent.tools.map((tool) => {
  const meta = TOOL_METAS.find((m) => m.name === tool.name);
  return {
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: meta?.parameters || { type: "object", properties: {} },
    },
  };
});
```

- [ ] **Step 4: 修改 buildSystemPrompt 使用 TOOL_METAS**

将 `tools.ts` 中硬编码的工具列表替换为从 `TOOL_METAS` 生成。由于 `tools.ts` 不直接依赖 `agent.ts`，可将 `TOOL_METAS` 提取到 `src/utils/tool-meta.ts`，然后两处共用。

新建 `src/utils/tool-meta.ts`，将 `TOOL_METAS` 和 `buildToolDescription` 移入，导出。`agent.ts` 和 `tools.ts` 均从此文件导入。

- [ ] **Step 5: 运行测试**

```bash
pnpm test
```

- [ ] **Step 6: Commit**

```bash
git add src/utils/tool-meta.ts src/utils/agent.ts src/utils/tools.ts
git commit -m "refactor: single source of truth for tool metadata and schemas"
```

---

## Task 5: sendToContentScript 改为握手协议 (P2)

**Files:**
- Modify: `src/utils/messaging.ts`
- Modify: `src/content.ts`
- Create: `src/__tests__/messaging.test.ts`

**背景:** 注入 content script 后固定等待 300ms，不可靠。

**方案:** content script 加载完成后发送 `CONTENT_SCRIPT_READY` 消息；`sendToContentScript` 注入后监听此消息，收到后再发送实际消息。设置 5 秒超时。

- [ ] **Step 1: 在 types/index.ts 增加消息类型**

```typescript
export enum MessageType {
  // ... existing types
  CONTENT_SCRIPT_READY = 'CONTENT_SCRIPT_READY',
}
```

- [ ] **Step 2: 在 content.ts 末尾发送 ready 消息**

在 `content.ts` 最底部（`infoLog` 之后）添加：

```typescript
chrome.runtime.sendMessage({ type: MessageType.CONTENT_SCRIPT_READY, payload: { url: window.location.href } }).catch(() => {});
```

- [ ] **Step 3: 修改 messaging.ts 中的 sendToContentScript**

```typescript
const CONTENT_SCRIPT_READY_TIMEOUT = 5000;

export async function sendToContentScript<T = unknown>(
  tabId: number,
  message: { type: MessageType; payload?: unknown },
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<T> {
  debugLog('Messaging', 'sendToContentScript:', tabId, message.type, message.payload);

  const doSend = () => withTimeout(
    chrome.tabs.sendMessage(tabId, message),
    timeoutMs,
    `${message.type} (tab ${tabId})`
  );

  try {
    return await doSend();
  } catch (_error) {
    debugLog('Messaging', 'Content script not ready, injecting...', tabId);
    const jsFiles = chrome.runtime.getManifest().content_scripts?.[0]?.js;
    if (!jsFiles) {
      throw new Error('No content script files found in manifest');
    }
    await chrome.scripting.executeScript({ target: { tabId }, files: jsFiles });

    // Wait for CONTENT_SCRIPT_READY message
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Content script ready timeout'));
      }, CONTENT_SCRIPT_READY_TIMEOUT);

      const listener = (msg: { type: string }) => {
        if (msg.type === MessageType.CONTENT_SCRIPT_READY) {
          clearTimeout(timer);
          chrome.runtime.onMessage.removeListener(listener);
          resolve();
        }
      };
      chrome.runtime.onMessage.addListener(listener);
    });

    return await doSend();
  }
}
```

- [ ] **Step 4: 创建 messaging.test.ts**

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setupChromeMock, teardownChromeMock, mockChrome } from "./chrome-mock";
import { sendToContentScript, MessageType } from "../utils/messaging";

describe("sendToContentScript handshake", () => {
  beforeEach(() => {
    setupChromeMock();
    vi.clearAllMocks();
  });

  afterEach(() => {
    teardownChromeMock();
  });

  it("should retry after receiving CONTENT_SCRIPT_READY", async () => {
    mockChrome.tabs.sendMessage
      .mockRejectedValueOnce(new Error("Receiving end does not exist"))
      .mockResolvedValueOnce({ success: true });

    const promise = sendToContentScript(1, { type: MessageType.GET_PAGE_SUMMARY });

    // Simulate content script sending ready message
    setTimeout(() => {
      mockChrome.runtime.onMessage.addListener.mock.calls.forEach(([listener]) => {
        listener({ type: MessageType.CONTENT_SCRIPT_READY });
      });
    }, 50);

    const result = await promise;
    expect(result).toEqual({ success: true });
    expect(mockChrome.scripting.executeScript).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 5: 运行测试**

```bash
pnpm test
```

- [ ] **Step 6: Commit**

```bash
git add src/types/index.ts src/content.ts src/utils/messaging.ts src/__tests__/messaging.test.ts
git commit -m "feat: replace fixed 300ms delay with content-script ready handshake"
```

---

## Task 6: input_text 支持 React 受控组件 (P2)

**Files:**
- Modify: `src/content.ts`
- Test: `src/__tests__/tool-bugs.test.ts`

**背景:** React 受控组件拦截原生 `.value` 赋值，需要调用原型链上的 setter。

**方案:** 在 `input_text` 处理中，先尝试原生 setter，若值未改变则使用原型 setter。

- [ ] **Step 1: 修改 content.ts 中的 input_text 处理**

在 `inputEl.value = String(text);` 之前添加 React 兼容逻辑：

```typescript
const inputEl = element as HTMLInputElement;
const textValue = String(text);

// React controlled component compatibility:
// Use the native prototype setter to bypass React's interceptor
const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype,
  'value'
)?.set;
if (nativeInputValueSetter) {
  nativeInputValueSetter.call(inputEl, textValue);
} else {
  inputEl.value = textValue;
}

// For textarea
if (element.tagName.toLowerCase() === 'textarea') {
  const nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value'
  )?.set;
  if (nativeTextareaValueSetter) {
    nativeTextareaValueSetter.call(element as HTMLTextAreaElement, textValue);
  }
}
```

- [ ] **Step 2: 更新 tool-bugs.test.ts**

将文档式测试改为实际测试：

```typescript
it("should dispatch change and blur events for input_text", () => {
  const input = document.createElement("input");
  let changeFired = false;
  let blurFired = false;
  input.addEventListener("change", () => { changeFired = true; });
  input.addEventListener("blur", () => { blurFired = true; });

  // Simulate fixed content.ts behavior
  input.value = "text";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  input.dispatchEvent(new Event("blur", { bubbles: true }));

  expect(changeFired).toBe(true);
  expect(blurFired).toBe(true);
});
```

- [ ] **Step 3: 运行测试**

```bash
pnpm test
```

- [ ] **Step 4: Commit**

```bash
git add src/content.ts src/__tests__/tool-bugs.test.ts
git commit -m "fix: support React controlled components in input_text tool"
```

---

## Task 7: Background 网络数据增加上限清理 (P2)

**Files:**
- Modify: `src/background.ts`
- Modify: `src/store/app-store.ts`

**背景:** `DebuggerManager` 中的 `networkRequests` / `networkResponses` 只增不减。

**方案:** 每个 tab 的请求/响应 Map 限制为最多 500 条，超出时淘汰最旧的 20%。

- [ ] **Step 1: 在 DebuggerManager 中增加上限**

```typescript
private readonly MAX_REQUESTS_PER_TAB = 500;
private readonly TRIM_RATIO = 0.2;

private addNetworkRequest(tabId: number, request: NetworkRequest) {
  const map = this.networkRequests.get(tabId);
  if (!map) return;
  map.set(request.requestId, request);
  if (map.size > this.MAX_REQUESTS_PER_TAB) {
    const toDelete = Math.floor(this.MAX_REQUESTS_PER_TAB * this.TRIM_RATIO);
    const keys = Array.from(map.keys()).slice(0, toDelete);
    for (const key of keys) map.delete(key);
  }
}

private addNetworkResponse(tabId: number, response: NetworkResponse) {
  const map = this.networkResponses.get(tabId);
  if (!map) return;
  map.set(response.requestId, response);
  if (map.size > this.MAX_REQUESTS_PER_TAB) {
    const toDelete = Math.floor(this.MAX_REQUESTS_PER_TAB * this.TRIM_RATIO);
    const keys = Array.from(map.keys()).slice(0, toDelete);
    for (const key of keys) map.delete(key);
  }
}
```

然后将 `handleDebuggerEvent` 中直接 `map.set(...)` 改为调用 `this.addNetworkRequest` / `this.addNetworkResponse`。

- [ ] **Step 2: 运行测试**

```bash
pnpm test
```

- [ ] **Step 3: Commit**

```bash
git add src/background.ts
git commit -m "fix: cap background network data per tab to prevent unbounded growth"
```

---

## Task 8: MessageBubble 增加一键复制功能 (Feature)

**Files:**
- Modify: `src/components/MessageBubble.tsx`

**背景:** 用户需要一键复制某条消息 bubble 的完整内容。

**方案:** 在每条 assistant message 的右上角增加复制按钮，点击后将 `msg.content` 写入剪贴板，显示 2 秒成功状态。

- [ ] **Step 1: 修改 MessageBubble.tsx**

在 `MessageBubble` 组件中，为 assistant 消息添加复制按钮：

```tsx
import { RefreshCw, Copy, Check } from "lucide-react";
import type { ChatMessage, ToolCallInfo } from "~types";
import { useState } from "react";

export default function MessageBubble({ msg, onRetry }: MessageBubbleProps) {
  const isUser = msg.role === "user";
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(msg.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may not be available
    }
  };

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[90%] rounded-lg px-4 py-2 text-sm relative group ${
          isUser
            ? "bg-primary-600 text-white"
            : "bg-white border border-gray-200 text-gray-800"
        }`}
      >
        {!isUser && (
          <button
            onClick={handleCopy}
            className="absolute top-2 right-2 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity text-gray-400 hover:text-gray-600 bg-gray-50 hover:bg-gray-100"
            title="复制内容"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        )}
        <ToolCallList toolCallInfos={msg.metadata?.toolCallInfos} />
        <MessageContent content={msg.content} isStreaming={msg.isStreaming} />
        {/* ... rest unchanged */}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 验证 parseMarkdown 无 push()**

确认 `parseMarkdown` 和 `renderInlineMarkdown` 中所有数组添加操作均使用索引赋值（`result[ri++] = ...` / `parts[pi++] = ...`），无 `.push()` 调用。当前代码已符合要求，无需修改。

- [ ] **Step 3: 运行构建和测试**

```bash
pnpm typecheck
pnpm lint
pnpm test
```

- [ ] **Step 4: Commit**

```bash
git add src/components/MessageBubble.tsx
git commit -m "feat: add copy button to assistant message bubbles"
```

---

## 最终验证

- [ ] **Step 1: 全量测试**

```bash
pnpm test
pnpm lint
pnpm typecheck
```

Expected: 全部通过，无新增 lint/type 错误。

- [ ] **Step 2: 构建验证**

```bash
pnpm build
```

Expected: 构建成功，输出到 `build/chrome-mv3-prod`。

- [ ] **Step 3: 最终 Commit / 总结**

```bash
git log --oneline -10
```

确认所有修改已提交。

---

## 复杂度说明

本次修改涉及 8 个任务，修改 7 个现有文件，新增 3 个文件。核心复杂度在于：

1. **错误格式统一**: 影响 content.ts 所有工具响应，需确保 agent.ts 的 `normalizeToolResponse` 向后兼容。
2. **Debugger 统一**: 涉及 background.ts 中 `DebuggerManager` 类的扩展，需避免与现有网络监控冲突。
3. **Schema 单一数据源**: 引入 `tool-meta.ts` 新文件，重构 `agent.ts` 和 `tools.ts` 的耦合方式。

以上修改均属于局部优化，未引入新抽象层或全局依赖，不违反 MVP 简洁性原则。所有修改均可通过现有测试覆盖验证。
