# Page Analyzer - LLM 辅助爬虫

一个 Chrome 浏览器扩展（Manifest V3），帮助开发者分析网页结构并通过 AI 对话生成爬虫代码。

## 功能

- **AI 智能对话** — LangChain Agent 流式输出，LLM 可主动调用工具分析页面，支持停止/重试
- **Markdown 渲染** — 完整的 Markdown 格式支持，包括表格、加粗、斜体、链接、标题、列表、代码块等
- **DOM 元素选择器** — 悬停高亮选取页面元素，自动提取 XPath、CSS Selector、属性等
- **页面截图** — 截取当前页面可视区域，AI 可"看懂"页面布局
- **页面摘要** — 自动提取页面标题、标题结构、正文预览等信息作为 LLM 上下文
- **HTML 获取** — 获取页面完整 HTML 源码供 AI 分析
- **网络请求监控** — 通过 Chrome Debugger API 拦截并展示所有 HTTP 请求/响应详情
- **配置持久化** — API Key、Base URL、模型、温度等配置自动保存，聊天记录(session)持久化存储
- **多会话管理** — 支持创建多个会话，随时切换和查看历史对话

## Agent 工具列表

| 工具 | 功能 |
|------|------|
| `query_selector` | CSS 选择器查询页面元素 |
| `search_page` | 页面全文搜索 |
| `get_page_info` | 获取页面元信息（URL、标题等） |
| `get_selected_element` | 获取已选元素详情 |
| `click_element` | 点击页面元素 |
| `input_text` | 在输入框中输入文本 |
| `scroll_page` | 滚动页面（上/下/顶部/底部） |
| `hover_element` | 悬停触发菜单/提示 |
| `wait_for_element` | 等待元素出现 |
| `execute_script` | 执行自定义 JavaScript |
| `navigate` | 导航到新 URL |
| `go_back` | 返回上一页 |
| `go_forward` | 前进到下一页 |
| `get_cookies` | 获取页面 Cookie |
| `set_cookie` | 设置 Cookie |
| `capture_screenshot` | 截取当前页面可视区域 |
| `get_page_html` | 获取完整页面 HTML 源码 |
| `get_network_requests` | 获取监听到的网络请求列表 |

## 开发

```bash
# 安装依赖
pnpm install

# 开发模式（热更新）
pnpm dev

# 生产构建
pnpm build

# 打包（构建 + zip）
pnpm package

# 运行测试
pnpm test

# 测试监听模式
pnpm test:watch
```

开发模式加载 `build/chrome-mv3-dev`，生产构建加载 `build/chrome-mv3-prod`。

## 在 Chrome 中使用

1. 运行 `pnpm build`
2. 打开 `chrome://extensions`，开启"开发者模式"
3. 点击"加载已解压的扩展程序"，选择 `build/chrome-mv3-prod`
4. 点击扩展工具栏图标 → 打开侧边栏
5. 设置 API Key（支持任何 OpenAI 兼容 API），开始使用

## 架构

```
src/
├── background.ts       # Service Worker: 消息路由, Debugger 管理, 截图/HTML获取, 导航, Cookie管理, CDP Runtime.evaluate执行脚本(绕过CSP)
├── content.ts          # Content Script: 元素选取器, CSS查询, 全文搜索, 页面交互(点击/输入/滚动/悬停/等待)
├── sidepanel.tsx       # 侧边栏 UI (多会话管理, 流式聊天 + 网络请求)
├── style.css           # 全局样式 + Tailwind
├── types/index.ts      # TypeScript 类型定义
├── store/app-store.ts  # Zustand 状态管理 (API Key 加密持久化, 多会话)
├── components/         # UI 组件 (MessageBubble, ChatInput, NetworkTab)
└── utils/
    ├── agent.ts        # LangChain Agent (18工具, 工具调用循环+15次上限, 工具链保留截断, JSON感知截断, reasoning_content流式, 复杂内容转换 msgToApi, 60条对话历史上限)
    ├── messaging.ts    # 消息传递 (content script 自动注入+300ms初始化, 30秒超时保护)
    ├── crypto.ts       # Web Crypto API AES-GCM 加密
    ├── logger.ts       # 结构化日志 (debug/info/warn/error)
    └── tools.ts        # 系统提示构建
```

技术栈: Plasmo + React + TypeScript + TailwindCSS + Zustand + LangChain

## 技术细节

- 无 `popup.tsx` — 点击图标直接打开 Chrome 侧边栏
- 使用 LangChain `ChatOpenAI` 流式调用 LLM API，支持自定义 Base URL 和模型；follow-up 请求使用原生 `fetch` + SSE；`invokeModelRaw` 为全部 18 个工具定义了完整 JSON Schema 参数定义（修复之前空 `properties: {}` 导致推理模型无法正确传参的问题）；`msgToApi` 导出并使用 `convertContent` 处理复杂内容类型（`image_url` 等转 OpenAI 格式）
- LLM 可主动调用 18 种工具进行页面分析和交互，所有工具均已添加参数验证；自动处理 LangChain DynamicTool 的 `{input: "..."}` 参数包裹问题（仅当值以 `{` 或 `[` 开头时才解包，避免误判 `{input: "hello"}` 等合法参数）
- `execute_script` 通过 `sendMessage` 发送到 background.ts，使用 CDP `Runtime.evaluate` 绕过 CSP；Debugger 生命周期通过 `needsDetach` 标志管理（仅在我们 attach 时才 detach），`finally` 块保证资源释放；`returnByValue: true` 返回 JSON 序列化结果
- `input_text` 额外分发 `change` 和 `blur` 事件以兼容 React/Vue 等现代框架和表单验证库；submit 行为改为查找最近 form 元素提交
- 工具调用错误格式统一：`{success: false, error: ...}` 和 `{error: ...}` 两种格式自动归一化；工具结果截断使用 JSON 感知的 `truncateToolResult`（数组保留前 N 项，对象保留前 K 个 key）
- 消息传递基于 `chrome.runtime` API，类型安全的枚举派发，错误信息正确解析；所有消息发送均包含 30 秒超时保护（`Promise.race`）防止 content script 无响应时永久挂起
- 三层上下文保护：`toLangChainMessages` 对存储消息做工具链保留截断（单条 5k / 总量 40k / 最多 50 条）；`streamAgentResponse` 循环内对工具结果做 5k 截断（JSON 感知）并跳过空 HumanMessage；conversationHistory 限制 60 条防止无限增长
- 兼容 DeepSeek 等深度推理模型，`reasoning_content` 在流式 chunk 中实时捕获并作为 `[思考过程]...[/思考过程]` 输出，无需非流式回退
- 持久化存储包括：API Key (AES-GCM 加密) / Base URL / Model / Temperature / 聊天记录，支持跨会话保留
- 结构化页面摘要替代原始 HTML 截断，节省 LLM 上下文空间
- 使用 Vitest + happy-dom 进行测试，Chrome API 通过 mock 模拟；测试覆盖 parseInput、参数校验、消息转换(msgToApi)、工具错误格式、工具链保留截断、Debugger 生命周期、DOM 事件等
- Markdown 渲染引擎支持完整格式：表格、加粗、斜体、链接、标题、列表、代码块、分隔线等，使用自定义解析器实现，无外部依赖
