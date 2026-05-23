import { useEffect, useRef, useState } from "react";
import { Loader2, Globe, Settings, ChevronDown } from "lucide-react";
import { MessageType } from "~types";
import type { ElementInfo, ChatMessage, PageSummary, ToolCallInfo } from "~types";
import { sendMessage, addMessageListener, sendToContentScript } from "~utils/messaging";
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
import MessageBubble from "~components/MessageBubble";
import ChatInput from "~components/ChatInput";
import NetworkTab from "~components/NetworkTab";
import Toolbar from "~components/Toolbar";
import "../style.css";

let msgIdCounter = 0;
function generateMsgId(): string {
  return `${Date.now()}-${++msgIdCounter}`;
}

function formatPageSummary(summary: PageSummary): string {
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
    temperature,
    setTemperature,
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
          id: generateMsgId(),
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
          id: generateMsgId(),
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
          id: generateMsgId(),
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
          id: generateMsgId(),
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

  const handleSendMessage = async () => {
    if (!input.trim() || !apiKey) return;

    const userMsgId = generateMsgId();
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

    const assistantMsgId = generateMsgId();
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
      const chatModel = createChatModel(
        apiKey,
        baseUrl || "https://api.openai.com/v1",
        model,
        temperature
      );
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
          id: tc.id || `${generateMsgId()}-${tc.name}`,
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
        const finalMsgId = generateMsgId();
        addMessage({
          id: finalMsgId,
          role: "assistant",
          content: "",
          timestamp: Date.now(),
          isStreaming: true,
        });
        setStreamingMessageId(finalMsgId);

        // Second invocation with tool results
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
      if (error.name === "AbortError") {
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
    const idx = messages.indexOf(msg);
    for (let i = idx - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        setInput(messages[i].content);
        return;
      }
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

      {statusText && (
        <div className="bg-blue-50 border-b border-blue-200 px-4 py-1.5 text-xs text-blue-700 flex items-center gap-2">
          <Loader2 className="w-3 h-3 animate-spin" />
          {statusText}
        </div>
      )}

      {!apiKey ? (
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
          <input
            type="number"
            placeholder="Temperature (默认 0)"
            value={temperature}
            min={0}
            max={2}
            step={0.1}
            className="w-full px-3 py-2 border border-yellow-300 rounded text-sm"
            onChange={(e) => setTemperature(parseFloat(e.target.value))}
          />
        </div>
      ) : (
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
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-600 whitespace-nowrap">Temperature:</label>
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={temperature}
                className="flex-1"
                onChange={(e) => setTemperature(parseFloat(e.target.value))}
              />
              <span className="text-xs text-gray-600 w-8 text-right">{temperature}</span>
            </div>
          </div>
        </div>
      )}

      <Toolbar
        isPicking={isPicking}
        isLoading={isLoading}
        isDebuggerAttached={isDebuggerAttached}
        onStartPicking={handleStartPicking}
        onCaptureScreenshot={handleCaptureScreenshot}
        onGetPageHtml={handleGetPageHtml}
        onToggleDebugger={handleToggleDebugger}
      />

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
              <MessageBubble key={msg.id} msg={msg} onRetry={handleRetry} />
            ))}
            <div ref={messagesEndRef} />
          </div>
          <ChatInput
            input={input}
            setInput={setInput}
            isLoading={isLoading}
            apiKey={apiKey}
            onSend={handleSendMessage}
            onStop={handleStop}
          />
        </>
      ) : (
        <NetworkTab requests={networkRequests} responses={networkResponses} />
      )}
    </div>
  );
}

export default SidePanel;
