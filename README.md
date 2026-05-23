# Page Analyzer - LLM 辅助爬虫

一个 Chrome 浏览器扩展（Manifest V3），帮助开发者分析网页结构并通过 AI 对话生成爬虫代码。

## 功能

- **AI 智能对话** — SSE 流式输出，LLM 可主动调用工具分析页面，支持停止/重试
- **DOM 元素选择器** — 悬停高亮选取页面元素，自动提取 XPath、CSS Selector、属性等
- **页面截图** — 截取当前页面可视区域，AI 可"看懂"页面布局
- **页面摘要** — 自动提取页面标题、标题结构、正文预览等信息作为 LLM 上下文
- **HTML 获取** — 获取页面完整 HTML 源码供 AI 分析
- **网络请求监控** — 通过 Chrome Debugger API 拦截并展示所有 HTTP 请求/响应详情
- **配置持久化** — API Key、Base URL、模型、温度等配置自动保存，聊天记录(session)持久化存储

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
├── background.ts       # Service Worker: 消息路由, Debugger 管理, 截图, 导航/Cookie管理
├── content.ts          # Content Script: 元素选取器, CSS 查询, 全文搜索, 页面交互工具
├── sidepanel.tsx       # 侧边栏 UI (流式聊天 + 网络请求)
├── style.css           # 全局样式 + Tailwind
├── types/index.ts      # TypeScript 类型定义
├── store/app-store.ts  # Zustand 状态管理 (API Key 加密持久化)
├── components/         # UI 组件 (MessageBubble, ChatInput, NetworkTab, Toolbar)
└── utils/
    ├── agent.ts        # LangChain Agent 集成 (15个工具定义)
    ├── messaging.ts    # 消息传递工具
    ├── crypto.ts       # Web Crypto API AES-GCM 加密
    ├── streaming.ts    # SSE 流式解析器 (legacy)
    └── tools.ts        # 系统提示构建
```

技术栈: Plasmo + React + TypeScript + TailwindCSS + Zustand + LangChain

## 技术细节

- 无 `popup.tsx` — 点击图标直接打开 Chrome 侧边栏
- 使用原生 `fetch` + SSE 流式调用 LLM API，支持自定义 Base URL 和模型
- LLM 可主动调用 15 种工具进行页面分析和交互，所有工具均已添加参数验证
- 兼容 DeepSeek 等深度推理模型，自动处理 `reasoning_content` 字段
- 消息传递基于 `chrome.runtime` API，类型安全的枚举派发，错误信息正确解析
- 持久化存储包括：API Key (AES-GCM 加密) / Base URL / Model / Temperature / 聊天记录，支持跨会话保留
- 结构化页面摘要替代原始 HTML 截断，节省 LLM 上下文空间
