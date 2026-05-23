import { useCallback, useEffect, useRef, useState } from "react";
import {
  MousePointer,
  Camera,
  Bug,
  Send,
  Loader2,
  X,
  Globe,
  FileCode,
  Network,
  Settings,
  ChevronDown,
  RefreshCw,
} from "lucide-react";
import { MessageType } from "~types";
import type {
  ElementInfo,
  ChatMessage,
  NetworkRequest,
  NetworkResponse,
  PageSummary,
  ToolCallInfo,
} from "~types";
import { sendMessage, addMessageListener } from "~utils/messaging";
import { useAppStore } from "~store/app-store";
import { buildSystemPrompt } from "~utils/tools";
import {
  createChromeTools,
  createChatModel,
  toLangChainMessages,
  executeToolCalls,
  streamFollowUp,
} from "~utils/agent";
import { SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import "../style.css";

async function sendToContentScript<T = unknown>(
  tabId: number,
  message: { type: MessageType; payload?: unknown }
): Promise<T> {
  try {
    return await chrome.tabs.sendMessage(tabId, message);
  } catch {
    const manifest = chrome.runtime.getManifest();
    const jsFiles = manifest.content_scripts?.[0]?.js;
    if (jsFiles) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: jsFiles,
      });
    }
    return await chrome.tabs.sendMessage(tabId, message);
  }
}

function SidePanel() {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isPicking, setIsPicking] = useState(false);
  const [isDebuggerAttached, setIsDebuggerAttached] = useState(false);
  const [activeTab, setActiveTab] = useState<"chat" | "network">("chat");
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [summaryFetched, setSummaryFetched] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    messages,
    addMessage,
    updateMessage,
    appendToMessage,
    setMessageStreaming,
    clearMessages,
    selectedElement,
    setSelectedElement,
    screenshot,
    setScreenshot,
    pageSummary,
    setPageSummary,
    networkRequests,
    addNetworkRequest,
    networkResponses,
    addNetworkResponse,
    apiKey,
    setApiKey,
    baseUrl,
    setBaseUrl,
    model,
    setModel,
  } = useAppStore();

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const unsub1 = addMessageListener<ElementInfo>(
      MessageType.ELEMENT_SELECTED,
      (element) => {
        setSelectedElement(element);
        setIsPicking(false);
        const message: ChatMessage = {
          id: Date.now().toString(),
          role: "assistant",
          content: `已选择元素: \`${element.tagName}\`\n\n**XPath:** \`${element.xpath}\`\n**CSS Selector:** \`${element.cssSelector}\`\n\n**内容预览:**\n\`\`\`\n${element.innerText.slice(0, 200)}\n\`\`\``,
          timestamp: Date.now(),
          metadata: { elementInfo: element },
        };
        addMessage(message);
      }
    );

    const unsub2 = addMessageListener<NetworkRequest>(
      MessageType.NETWORK_REQUEST,
      (request) => {
        addNetworkRequest(request);
      }
    );

    const unsub3 = addMessageListener<NetworkResponse>(
      MessageType.NETWORK_RESPONSE,
      (response) => {
        addNetworkResponse(response);
      }
    );

    return () => {
      unsub1();
      unsub2();
      unsub3();
    };
  }, [addMessage, setSelectedElement, addNetworkRequest, addNetworkResponse]);

  // Fetch page summary on mount
  useEffect(() => {
    if (!summaryFetched) {
      (async () => {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.id) {
            const summary = await sendToContentScript<PageSummary>(tab.id, {
              type: MessageType.GET_PAGE_SUMMARY,
            });
            setPageSummary(summary);
            setSummaryFetched(true);
          }
        } catch {
          // content script may not be ready yet — skip silently
        }
      })();
    }
  }, [summaryFetched, setPageSummary]);

  const handleStartPicking = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;

      await sendToContentScript(tab.id, {
        type: MessageType.ELEMENT_HIGHLIGHT,
        payload: { active: true },
      });
      setIsPicking(true);
    } catch (error) {
      console.error("Failed to start picking:", error);
    }
  };

  const handleCaptureScreenshot = async () => {
    try {
      setIsLoading(true);
      setStatusText("正在截图...");
      const response = await sendMessage(MessageType.CAPTURE_SCREENSHOT, {});
      if (response?.screenshot) {
        setScreenshot(response.screenshot);
        const message: ChatMessage = {
          id: Date.now().toString(),
          role: "assistant",
          content: "已捕获页面截图",
          timestamp: Date.now(),
          metadata: { screenshot: response.screenshot },
        };
        addMessage(message);
      }
    } catch (error) {
      console.error("Failed to capture screenshot:", error);
    } finally {
      setIsLoading(false);
      setStatusText(null);
    }
  };

  const handleGetPageHtml = async () => {
    try {
      setIsLoading(true);
      setStatusText("正在获取页面 HTML...");
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;

      const response = await sendToContentScript<{ html: string; title: string; url: string }>(tab.id, {
        type: MessageType.GET_PAGE_HTML,
      });

      if (response?.html) {
        const msg: ChatMessage = {
          id: Date.now().toString(),
          role: "assistant",
          content: `已获取页面 HTML (${response.html.length} 字符)`,
          timestamp: Date.now(),
        };
        addMessage(msg);
      }
    } catch (error) {
      console.error("Failed to get page HTML:", error);
    } finally {
      setIsLoading(false);
      setStatusText(null);
    }
  };

  const handleToggleDebugger = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;

      if (isDebuggerAttached) {
        await sendMessage(MessageType.DEBUGGER_DETACH, { tabId: tab.id });
        setIsDebuggerAttached(false);
      } else {
        await sendMessage(MessageType.DEBUGGER_ATTACH, { tabId: tab.id });
        setIsDebuggerAttached(true);
        const message: ChatMessage = {
          id: Date.now().toString(),
          role: "assistant",
          content: "Debugger 已附加到当前页面，开始监听网络请求...",
          timestamp: Date.now(),
        };
        addMessage(message);
      }
    } catch (error) {
      console.error("Failed to toggle debugger:", error);
    }
  };

  const formatPageSummary = useCallback((summary: PageSummary): string => {
    return [
      `## Current Page`,
      `URL: ${summary.url}`,
      `Title: ${summary.title}`,
      `Description: ${summary.metaDescription || "(none)"}`,
      `Language: ${summary.language || "unknown"}`,
      ``,
      `### Headings Structure`,
      ...summary.headings.map((h) => `${"  ".repeat(Math.max(0, h.level - 1))}${"#".repeat(h.level)} ${h.text}`),
      ``,
      `### Content Preview (${summary.textContentLength} total chars)`,
      summary.mainContentPreview.slice(0, 2000),
      ``,
      `Links: ${summary.linkCount} | Images: ${summary.imageCount}`,
    ].join("\n");
  }, []);


  const handleSendMessage = async () => {
    if (!input.trim() || !apiKey) return;

    const userMsgId = Date.now().toString();
    const userMessage: ChatMessage = {
      id: userMsgId,
      role: "user",
      content: input,
      timestamp: Date.now(),
    };
    addMessage(userMessage);
    const currentInput = input;
    setInput("");
    setIsLoading(true);
    setStatusText("正在连接 LLM...");

    // Cancel any previous request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    const assistantMsgId = (Date.now() + 1).toString();
    const placeholder: ChatMessage = {
      id: assistantMsgId,
      role: "assistant",
      content: "",
      timestamp: Date.now(),
      isStreaming: true,
    };
    addMessage(placeholder);
    setStreamingMessageId(assistantMsgId);

    try {
      // Fetch page summary if not yet fetched
      if (!summaryFetched) {
        try {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          if (tab?.id) {
            const summary = await sendToContentScript<PageSummary>(tab.id, {
              type: MessageType.GET_PAGE_SUMMARY,
            });
            setPageSummary(summary);
            setSummaryFetched(true);
          }
        } catch {
          // continue without summary
        }
      }

      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) {
        throw new Error("No active tab");
      }

      // Build system prompt with page context
      const contextParts: string[] = [];
      if (pageSummary) {
        contextParts.push(formatPageSummary(pageSummary));
      }
      if (selectedElement) {
        contextParts.push(
          `## Selected Element\ntagName: ${selectedElement.tagName}\nXPath: ${selectedElement.xpath}\nCSS: ${selectedElement.cssSelector}\nText: ${selectedElement.innerText.slice(0, 200)}`
        );
      }
      const pageContext = contextParts.length > 0 ? contextParts.join("\n\n") : "No page context available yet.";
      const systemContent = buildSystemPrompt(pageContext, true);

      // Create LangChain chat model with tools
      const chatModel = createChatModel(apiKey, baseUrl || "https://api.openai.com/v1", model);
      const tools = createChromeTools(tab.id);
      const modelWithTools = chatModel.bindTools(tools);

      // Build messages: system + history + current user input
      const systemMsg = new SystemMessage(systemContent);
      const historyMsgs = toLangChainMessages(messages.slice(-20));
      const userMsg = screenshot
        ? new HumanMessage({
            content: [
              { type: "text", text: currentInput },
              { type: "image_url", image_url: { url: screenshot } },
            ],
          })
        : new HumanMessage(currentInput);
      const allMessages = [systemMsg, ...historyMsgs, userMsg];

      setStatusText("正在生成...");

      // Track tool call info for UI
      let currentToolCalls: ToolCallInfo[] = [];

      // First invocation: may return content or tool_calls
      const response = await modelWithTools.invoke(allMessages, {
        signal: controller.signal,
        callbacks: [
          {
            handleLLMNewToken: (token: string) => {
              appendToMessage(assistantMsgId, token);
            },
          },
        ],
      });

      // Handle tool calls if any
      if (response.tool_calls?.length && !controller.signal.aborted) {
        setStatusText("正在分析页面...");

        // Show tool call info in the current message
        currentToolCalls = response.tool_calls.map((tc) => ({
          id: tc.id || `${Date.now()}-${tc.name}`,
          name: tc.name,
          status: "running" as const,
        }));
        updateMessage(assistantMsgId, {
          content: "",
          metadata: { toolCallInfos: currentToolCalls },
          isStreaming: false,
        });

        // Execute tools in parallel
        const toolMessages = await executeToolCalls(response.tool_calls, tab.id);

        // Mark all tools as completed
        currentToolCalls = currentToolCalls.map((t) => ({
          ...t,
          status: "completed" as const,
        }));
        updateMessage(assistantMsgId, {
          metadata: { toolCallInfos: currentToolCalls },
        });

        setStatusText("正在生成...");

        // Create a new assistant message for the final response
        const finalMsgId = (Date.now() + 2).toString();
        addMessage({
          id: finalMsgId,
          role: "assistant",
          content: "",
          timestamp: Date.now(),
          isStreaming: true,
        });
        setStreamingMessageId(finalMsgId);

        // Second invocation with tool results
        // Use direct fetch to properly handle reasoning_content pass-back
        // (LangChain's serializer drops additional_kwargs.reasoning_content)
        const followUpStream = streamFollowUp(
          apiKey,
          baseUrl || "https://api.openai.com/v1",
          model,
          allMessages,
          response as AIMessage,
          toolMessages,
          controller.signal
        );

        for await (const token of followUpStream) {
          if (controller.signal.aborted) break;
          appendToMessage(finalMsgId, token);
        }

        setMessageStreaming(finalMsgId, false);
      } else if (!controller.signal.aborted) {
        // No tool calls — content was streamed directly
        setMessageStreaming(assistantMsgId, false);
      }
    } catch (error: any) {
      if (error.name === "AbortError" || error.name === "TypeError") {
        updateMessage(assistantMsgId, { content: "已取消", isStreaming: false });
      } else {
        const errMsg = error.message || String(error);
        updateMessage(assistantMsgId, { content: `Error: ${errMsg}`, isStreaming: false });
      }
    } finally {
      setIsLoading(false);
      setStreamingMessageId(null);
      setStatusText(null);
      abortRef.current = null;
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    if (streamingMessageId) {
      setMessageStreaming(streamingMessageId, false);
    }
    setIsLoading(false);
    setStreamingMessageId(null);
    setStatusText(null);
  };

  const handleRetry = (msg: ChatMessage) => {
    // Find the preceding user message and resend
    const idx = messages.indexOf(msg);
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        setInput(messages[i].content);
        return;
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <Globe className="w-5 h-5 text-primary-600" />
            Page Analyzer
          </h1>
          <div className="flex gap-1">
            <button
              onClick={() => setActiveTab("chat")}
              className={`px-3 py-1 text-sm rounded ${activeTab === "chat" ? "bg-primary-100 text-primary-700" : "text-gray-600 hover:bg-gray-100"}`}
            >
              对话
            </button>
            <button
              onClick={() => setActiveTab("network")}
              className={`px-3 py-1 text-sm rounded ${activeTab === "network" ? "bg-primary-100 text-primary-700" : "text-gray-600 hover:bg-gray-100"}`}
            >
              网络
            </button>
          </div>
        </div>
      </header>

      {/* Status bar */}
      {statusText && (
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-1.5 text-xs text-blue-700 flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin" />
          {statusText}
        </div>
      )}

      {/* Settings */}
      {!apiKey && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-3 space-y-2">
          <label className="block text-sm font-medium text-yellow-800 mb-1">API 配置</label>
          <input
            type="password"
            placeholder="API Key (必填)"
            value={apiKey}
            className="w-full px-3 py-2 border border-yellow-300 rounded text-sm"
            onChange={(e) => setApiKey(e.target.value)}
          />
          <input
            type="text"
            placeholder="Base URL (可选，默认 OpenAI)"
            value={baseUrl}
            className="w-full px-3 py-2 border border-yellow-300 rounded text-sm"
            onChange={(e) => setBaseUrl(e.target.value)}
          />
          <input
            type="text"
            placeholder="模型 (默认 gpt-4o-mini)"
            value={model}
            className="w-full px-3 py-2 border border-yellow-300 rounded text-sm"
            onChange={(e) => setModel(e.target.value)}
          />
        </div>
      )}

      {apiKey && (
        <div className="bg-gray-50 border-b border-gray-200 px-4 py-2">
          <button
            onClick={() => {
              const el = document.getElementById("api-config");
              if (el) el.classList.toggle("hidden");
            }}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700"
          >
            <Settings className="w-3 h-3" />
            API 配置
            <ChevronDown className="w-3 h-3" />
          </button>
          <div id="api-config" className="hidden mt-2 space-y-2">
            <input
              type="password"
              placeholder="API Key"
              value={apiKey}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
              onChange={(e) => setApiKey(e.target.value)}
            />
            <input
              type="text"
              placeholder="Base URL (可选，默认 OpenAI)"
              value={baseUrl}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
              onChange={(e) => setBaseUrl(e.target.value)}
            />
            <input
              type="text"
              placeholder="模型 (默认 gpt-4o-mini)"
              value={model}
              className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
              onChange={(e) => setModel(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex gap-2 p-3 bg-white border-b border-gray-200">
        <button
          onClick={handleStartPicking}
          disabled={isPicking}
          className={`flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded text-sm font-medium transition-colors ${
            isPicking ? "bg-primary-100 text-primary-700" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          <MousePointer className="w-4 h-4" />
          {isPicking ? "选择中..." : "选择元素"}
        </button>
        <button
          onClick={handleCaptureScreenshot}
          disabled={isLoading}
          className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-gray-100 text-gray-700 rounded text-sm font-medium hover:bg-gray-200 transition-colors"
        >
          <Camera className="w-4 h-4" />
          截图
        </button>
        <button
          onClick={handleGetPageHtml}
          disabled={isLoading}
          className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-gray-100 text-gray-700 rounded text-sm font-medium hover:bg-gray-200 transition-colors"
        >
          <FileCode className="w-4 h-4" />
          HTML
        </button>
        <button
          onClick={handleToggleDebugger}
          className={`flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded text-sm font-medium transition-colors ${
            isDebuggerAttached ? "bg-red-100 text-red-700 hover:bg-red-200" : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          <Bug className="w-4 h-4" />
          {isDebuggerAttached ? "停止" : "调试"}
        </button>
      </div>

      {/* Chat tab */}
      {activeTab === "chat" ? (
        <>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="text-center text-gray-500 py-8">
                <Globe className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p className="text-sm">欢迎使用 Page Analyzer</p>
                <p className="text-xs mt-1">页面摘要已自动获取，发送消息即可开始分析</p>
              </div>
            )}

            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[90%] rounded-lg px-4 py-2 text-sm ${
                    msg.role === "user"
                      ? "bg-primary-600 text-white"
                      : "bg-white border border-gray-200 text-gray-800"
                  }`}
                >
                  {/* Tool call info */}
                  {msg.metadata?.toolCallInfos && msg.metadata.toolCallInfos.length > 0 && (
                    <div className="mb-2 space-y-1 border border-gray-200 rounded p-2 bg-gray-50 text-xs">
                      {msg.metadata.toolCallInfos.map((tc) => (
                        <div key={tc.id} className="flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              tc.status === "running"
                                ? "bg-yellow-400 animate-pulse"
                                : tc.status === "completed"
                                  ? "bg-green-500"
                                  : "bg-red-500"
                            }`}
                          />
                          <span className="font-mono text-gray-700">{tc.name}</span>
                          {tc.status === "running" && <span className="text-yellow-600">执行中...</span>}
                          {tc.status === "completed" && <span className="text-green-600">完成</span>}
                          {tc.status === "error" && <span className="text-red-600">错误</span>}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Message content */}
                  <div className="whitespace-pre-wrap">
                    {msg.content.split("```").map((part, index) => {
                      if (index % 2 === 1) {
                        return (
                          <pre
                            key={index}
                            className="bg-gray-900 text-gray-100 p-2 rounded my-2 overflow-x-auto"
                          >
                            <code>{part}</code>
                          </pre>
                        );
                      }
                      return part.split("`").map((inline, i) => {
                        if (i % 2 === 1) {
                          return (
                            <code key={i} className="bg-gray-100 px-1 rounded text-primary-700">
                              {inline}
                            </code>
                          );
                        }
                        return inline;
                      });
                    })}
                    {/* Streaming cursor */}
                    {msg.isStreaming && (
                      <span className="inline-block w-2 h-4 bg-gray-600 animate-blink ml-0.5" />
                    )}
                  </div>

                  {/* Screenshot */}
                  {msg.metadata?.screenshot && (
                    <img
                      src={msg.metadata.screenshot}
                      alt="Screenshot"
                      className="mt-2 rounded max-w-full"
                    />
                  )}

                  {/* Retry button */}
                  {msg.content.startsWith("Error:") && !msg.isStreaming && (
                    <button
                      onClick={() => handleRetry(msg)}
                      className="mt-2 flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700"
                    >
                      <RefreshCw className="w-3 h-3" />
                      重试
                    </button>
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Input area */}
          <div className="border-t border-gray-200 bg-white p-3">
            <div className="flex gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={apiKey ? "输入消息..." : "请先设置 API Key"}
                disabled={!apiKey || isLoading}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg resize-none text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                rows={2}
              />
              {isLoading ? (
                <button
                  onClick={handleStop}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              ) : (
                <button
                  onClick={handleSendMessage}
                  disabled={!input.trim() || !apiKey}
                  className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Send className="w-5 h-5" />
                </button>
              )}
            </div>
          </div>
        </>
      ) : (
        /* Network tab */
        <div className="flex-1 overflow-y-auto">
          <div className="p-3 space-y-2">
            {networkRequests.length === 0 ? (
              <div className="text-center text-gray-500 py-8 text-sm">
                <Network className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                暂无网络请求
              </div>
            ) : (
              networkRequests.map((req) => {
                const response = networkResponses.find((r) => r.requestId === req.requestId);
                return (
                  <div key={req.requestId} className="bg-white border border-gray-200 rounded p-3 text-xs">
                    <div className="flex items-center gap-2 mb-1">
                      <span
                        className={`px-1.5 py-0.5 rounded font-medium ${
                          req.method === "GET"
                            ? "bg-green-100 text-green-700"
                            : req.method === "POST"
                              ? "bg-blue-100 text-blue-700"
                              : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {req.method}
                      </span>
                      <span className="text-gray-600 truncate flex-1">{req.url}</span>
                    </div>
                    {response && (
                      <div className="flex items-center gap-2 text-gray-500">
                        <span
                          className={`px-1.5 py-0.5 rounded ${
                            response.status < 300
                              ? "bg-green-50 text-green-600"
                              : response.status < 400
                                ? "bg-yellow-50 text-yellow-600"
                                : "bg-red-50 text-red-600"
                          }`}
                        >
                          {response.status}
                        </span>
                        {response.body && <span className="text-gray-400">{response.body.length} bytes</span>}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default SidePanel;
