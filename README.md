# Page Analyzer - LLM 辅助爬虫

一个 Chrome 浏览器扩展（Manifest V3），帮助开发者分析网页结构并通过 AI 对话生成爬虫代码。

## 功能

- **AI 智能对话** — SSE 流式输出，LLM 可主动调用工具分析页面（CSS 查询、全文搜索），支持停止/重试
- **DOM 元素选择器** — 悬停高亮选取页面元素，自动提取 XPath、CSS Selector、属性等
- **页面截图** — 截取当前页面可视区域，AI 可"看懂"页面布局
- **页面摘要** — 自动提取页面标题、标题结构、正文预览等信息作为 LLM 上下文
- **HTML 获取** — 获取页面完整 HTML 源码供 AI 分析
- **网络请求监控** — 通过 Chrome Debugger API 拦截并展示所有 HTTP 请求/响应详情

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
├── background.ts       # Service Worker: 消息路由, Debugger 管理, 截图
├── content.ts          # Content Script: 元素选取器, CSS 查询, 全文搜索, 页面摘要
├── sidepanel.tsx       # 侧边栏 UI (流式聊天 + 网络请求)
├── style.css           # 全局样式 + Tailwind
├── types/index.ts      # TypeScript 类型定义 (含 ToolCall, PageSummary, StreamChunk)
├── store/app-store.ts  # Zustand 状态管理 (含 streaming 方法)
└── utils/
    ├── messaging.ts    # 消息传递工具
    ├── streaming.ts    # SSE 流式解析器
    └── tools.ts        # 工具定义 + 工具调用循环
```

技术栈: Plasmo + React + TypeScript + TailwindCSS + Zustand

## 技术细节

- 无 `popup.tsx` — 点击图标直接打开 Chrome 侧边栏
- 使用原生 `fetch` + SSE 流式调用 LLM API，无需 OpenAI SDK，支持自定义 Base URL 和模型
- LLM 可主动调用 4 种工具：CSS 选择器查询、全文搜索、页面元信息、已选元素详情
- 消息传递基于 `chrome.runtime` API，类型安全的枚举派发
- 持久化存储仅 API Key / Base URL / Model 三项，其余状态为内存态
- 结构化页面摘要替代原始 HTML 截断，节省 LLM 上下文空间
