# Page Analyzer — 架构设计与理念

## 项目概述

Page Analyzer 是一个 Chrome 扩展（Manifest V3），帮助开发者分析网页结构并通过 AI 对话生成爬虫代码。技术栈：Plasmo + React + TypeScript + TailwindCSS + Zustand。

核心能力：元素选择 → 页面感知 → AI 对话 → 代码生成，形成一个完整闭环。

---

## 一、架构总览

### 1.1 三层消息模型

```
 ┌─────────────────────────────────────────────────────────────┐
 │                    sidepanel.tsx (React UI)                  │
 │   Chat 面板  |  网络请求面板  |  工具栏 (选择/截图/HTML/调试) │
 └──────────┬────────────────────────────────────────┬──────────┘
            │ chrome.runtime.sendMessage              │ chrome.tabs.sendMessage
            ▼                                         ▼
 ┌──────────────────┐                    ┌──────────────────────┐
 │  background.ts   │◄──── 转发 ─────────│    content.ts        │
 │ (Service Worker) │                    │  (Content Script)    │
 │                  │                    │                      │
 │  DebuggerManager │                    │  ElementPicker       │
 │  Screenshot      │                    │  querySelectorAll    │
 │  HTML capture    │                    │  TreeWalker 全文搜索 │
 └────────┬─────────┘                    │  PageSummary 提取    │
          │                              └──────────────────────┘
          ▼
 ┌──────────────────┐
 │  Chrome Debugger │
 │  API (CDP)       │
 │  Network 监控     │
 └──────────────────┘
```

**设计理念**：background.ts 作为轻量级路由枢纽，不处理业务逻辑。content.ts 负责所有 DOM 操作，sidepanel.tsx 负责所有 UI 和 LLM 交互。每一层职责单一，避免职责重叠。

### 1.2 模块职责

| 模块 | 职责 | 关键约束 |
|------|------|----------|
| `background.ts` | 消息中转、Debugger 生命周期、截图捕获 | Service Worker 无 DOM、短生命周期、30s 空闲卸载 |
| `content.ts` | DOM 选取器、CSS 查询、全文搜索、页面摘要 | 运行在页面上下文中，可用完整 DOM API |
| `sidepanel.tsx` | 全部 UI、LLM 流式对话、工具调用循环 | 需通过消息传递间接操作页面 |
| `types/index.ts` | 所有类型定义中心 | 被所有模块引用，单一事实来源 |
| `store/app-store.ts` | Zustand 全局状态 | persist 只持久化 API 配置，其余内存态 |

---

## 二、设计理念

### 2.1 无 SDK 原则

不依赖 OpenAI SDK 或任何 LLM SDK，直接使用 `fetch()` + SSE 解析。原因：

1. **包体积**：Plasmo/Parcel 打包时，OpenAI SDK v4 因浏览器全局 `Audio` 声明冲突而不可用
2. **灵活性**：支持任意 OpenAI 兼容 API（DeepSeek、Claude、本地模型等），只需切换 base_url
3. **可控性**：SSE 流式解析、AbortController 取消、请求组装完全透明

对应模块：`src/utils/streaming.ts` — 基于 `response.body.getReader()` + `TextDecoder` 的 SSE 解析器。

### 2.2 结构化上下文替代原始 HTML

**问题**：原始 HTML 中 `<head>` 等元数据占据大量 token，真正对 LLM 有价值的是页面结构信息。

**方案**：`PageSummary` 结构化对象：

```
URL / Title / Meta Description / Language
→ Headings 树 (h1-h6)
→ 正文预览 (前 2000 字符)
→ 统计 (链接数 / 图片数 / 总字符数)
```

**好处**：上下文 token 从数万降至数百，且信息密度更高。只有当 LLM 通过工具调用明确需要时，才获取完整 HTML 或特定 DOM 元素。

### 2.3 LLM-in-the-Loop 工具调用

```
用户提问 → LLM 流式生成
              │
              ├─ 遇到 tool_call → 累积 delta
              ├─ stream 结束 → 检查是否有 tool_calls
              │        │
              │        ├─ 有 → 执行工具 (content script)
              │        │       └─ 工具结果 → 第二次 LLM 请求 → 流式输出最终回答
              │        │
              │        └─ 无 → 直接展示
              │
              └─ 用户可随时 AbortController.abort() 终止
```

**设计要点**：
- tool_call 通过 SSE delta 累积而不是等全部就绪，减少首 token 延迟
- 工具并行执行（Promise.all），不阻塞
- 第二次请求不加 tools 参数，避免 LLM 再次调用工具形成死循环
- 配合 `tool_choice: "auto"`，由 LLM 自主决定是否调用工具

### 2.4 自适应内容脚本注入

Chrome 扩展中 content script 只在安装时注入到已加载的标签页。用户在安装后已打开的页面中，content script 不存在。

**方案**：`sendToContentScript` 函数捕获"Receiving end does not exist"错误，自动通过 `chrome.scripting.executeScript` 注入 content script 后重试。

```typescript
async function sendToContentScript<T>(tabId, message): Promise<T> {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    // 自动注入 content script 后重试
    const jsFiles = chrome.runtime.getManifest().content_scripts[0].js;
    await chrome.scripting.executeScript({ target: { tabId }, files: jsFiles });
    return await chrome.tabs.sendMessage(tabId, message);
  }
}
```

### 2.5 最小持久化策略

Zustand store 使用 `persist` 中间件，但只持久化三项敏感配置：

```typescript
partialize: (state) => ({
  apiKey: state.apiKey,
  baseUrl: state.baseUrl,
  model: state.model,
})
```

所有运行时状态（消息历史、页面摘要、网络请求等）在页面刷新后丢失。理由：
- 消息历史包含页面敏感内容，不应持久化到 storage
- API 配置由用户主动输入，持久化避免重复输入
- 网络请求和截图是瞬时状态，无持久化价值

### 2.6 单轮工具调用循环

当前设计限定工具调用最多一轮（LLM → 工具 → LLM），不会递归调用。理由：
1. 防无限循环：如果第一次工具调用结果又触发新的 tool_call，复杂度不可控
2. 用户体验可预测：用户总是能在两次流式输出内看到最终结果
3. 多数场景下，一轮工具调用足以回答用户问题

---

## 三、关键数据流

### 3.1 元素选择流程

```
用户点击"选择元素"
       │
       ▼
sidepanel → [ELEMENT_HIGHLIGHT] → content.ts
                                      │
                               ElementPicker.activate()
                               (透明 overlay + mouse events)
                                      │
                              用户点击元素
                                      │
                              提取 XPath / CSS Selector / rect
                              存储到 window.__pageAnalyzerSelectedElement
                                      │
                              发送 [ELEMENT_SELECTED]
                                      │
                          ┌───────────┴────────────┐
                          ▼                        ▼
                   background.ts 转发    sidepanel 直接收到
                   (已移除，避免重复)        │
                                           ▼
                                    添加 assistant 消息 (含元素详情)
```

**注意**：content script 的 `chrome.runtime.sendMessage` 广播到所有扩展页面（background + sidepanel）。background 只转发需要处理的消息，`ELEMENT_SELECTED` 由 sidepanel 直接处理，background 不做任何操作，避免重复。

### 3.2 LLM 消息组装

```
buildLLMMessages()
       │
       ├─ system prompt (buildSystemPrompt)
       │    ├─ 页面上下文 (PageSummary + 选中元素)
       │    └─ 工具描述 + 使用指南
       │
       ├─ 历史消息 × 20 (最近)
       │    ├─ user → { role, content }
       │    ├─ assistant → { role, content }
       │    └─ tool → { role, tool_call_id, content, name }
       │
       └─ 当前用户消息
            ├─ text (字符串)
            └─ 如果有截图 → [{ type: "text" }, { type: "image_url" }]
```

### 3.3 网络监控流程

```
用户点击"调试" → [DEBUGGER_ATTACH] → background.ts
                                          │
                                   chrome.debugger.attach()
                                   chrome.debugger.sendCommand(Network.enable)
                                          │
                                   CDP 事件:
                                   Network.requestWillBeSent → 存储 + 推送
                                   Network.responseReceived → 存储 + 获取 body
                                   Network.getResponseBody  → 解码 + 推送
                                          │
                                   [NETWORK_REQUEST] / [NETWORK_RESPONSE]
                                          │
                                          ▼
                                   sidepanel.network 面板
```

---

## 四、状态管理

### 4.1 状态分组

```
AppState
├── Chat (内存)      messages, addMessage, updateMessage, appendToMessage, ...
├── Element (内存)    selectedElement, setSelectedElement
├── Page (内存)       screenshot, pageSummary
├── Network (内存)    networkRequests, networkResponses
└── Settings (持久化)  apiKey, baseUrl, model
```

### 4.2 流式消息更新

Zustand 的不可变更新原则对流式场景意味着：每次 `appendToMessage` 创建新数组 → React 重渲染。这是可接受的，因为：

- 消息列表通常不超过 50 条
- 每次 append 只更新一条消息的 content
- React 的 diff 只渲染新增文本节点

```typescript
appendToMessage: (id, chunk) => set((state) => ({
  messages: state.messages.map((m) =>
    m.id === id ? { ...m, content: m.content + chunk } : m
  )
}))
```

---

## 五、配置与构建

### 5.1 Plasmo 框架约定

| 约定 | 说明 |
|------|------|
| 入口文件 | 必须在 `src/` 目录下（v0.90.5） |
| 自动发现 | background.ts, content.ts, sidepanel.tsx 自动识别 |
| 路径别名 | `~` → `./src/` |
| 构建输出 | `build/chrome-mv3-prod`（生产） / `build/chrome-mv3-dev`（开发） |
| CSS | 由组件 import 引入，支持 PostCSS / Tailwind |

### 5.2 无 Popup

popup.tsx 被有意移除。点击扩展图标直接打开 Chrome Side Panel：

```typescript
// background.ts
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    await chrome.sidePanel.open({ tabId: tab.id });
  }
});
```

前提：manifest 中不能设置 `default_popup`，否则 `onClicked` 不会触发。

---

## 六、边界情况与防御

| 场景 | 处理方式 |
|------|----------|
| content script 未注入 | 自动注入并重试（sendToContentScript） |
| 页面不响应消息 | 捕获 chrome.runtime.lastError，返回兜底值 |
| SSE 流解析失败 | 跳过畸形行，继续处理后续数据 |
| API 返回错误 | 读取 JSON body 提取 error.message |
| 用户中途取消 | AbortController.abort()，显示"已取消" |
| tool 调用失败 | 标记 status=error，回传错误信息给 LLM |
| 无页面上下文 | "No page context available yet." 占位 |
| 消息内容含代码块 | 以 ``` 分割，代码块用 <pre> 渲染，内联代码用 <code> |

---

## 七、演进方向

- **多轮工具调用**：允许 LLM 基于工具结果再次调用工具
- **可中断流式**：当前支持 stop，未来可支持暂停/恢复
- **会话管理**：多会话切换、导出/导入
- **MCP 集成**：通过 Model Context Protocol 扩展工具集
- **持久化消息历史**：可选的 indexedDB 存储
