import { useEffect, useRef, useState } from "react";
import { Loader2, Globe, ChevronDown, Settings } from "lucide-react";
import { MessageType } from "~types";
import type { ElementInfo, ChatMessage, PageSummary, ToolCallInfo, NetworkRequest, NetworkResponse } from "~types";
import { addMessageListener, sendToContentScript } from "~utils/messaging";
import { useAppStore } from "~store/app-store";
import { buildSystemPrompt } from "~utils/tools";
import {
  createAgentForTab,
  streamAgentResponse,
} from "~utils/agent";
import { debugLog, errorLog, infoLog } from "~utils/logger";
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
        debugLog('SidePanel', 'Element selected:', element.tagName);
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
            debugLog('SidePanel', 'Fetching page summary for tab:', tab.id);
            const summary = await sendToContentScript<PageSummary>(tab.id, {
              type: MessageType.GET_PAGE_SUMMARY,
            });
            debugLog('SidePanel', 'Page summary fetched:', summary.title);
            setPageSummary(summary);
            setSummaryFetched(true);
          }
        } catch (e) {
          debugLog('SidePanel', 'Failed to fetch page summary:', e);
        }
      })();
    }
  }, [summaryFetched, setPageSummary]);

  const handleStartPicking = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;

      debugLog('SidePanel', 'Starting element picking');
      await sendToContentScript(tab.id, {
        type: MessageType.ELEMENT_HIGHLIGHT,
        payload: { active: true },
      });
      setIsPicking(true);
    } catch (error) {
      errorLog('SidePanel', 'Failed to start picking:', error);
    }
  };

  const handleNewSession = async () => {
    debugLog('SidePanel', 'Starting new session');
    clearMessages();
    setSelectedElement(null);
    setScreenshot(null);
    setSummaryFetched(false);
    setInput("");
  };

  const handleSendMessage = async () => {
    if (!input.trim() || !apiKey) return;

    infoLog('SidePanel', 'Sending message, input length:', input.length);

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
            debugLog('SidePanel', 'Fetching page summary before sending message');
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

      debugLog('SidePanel', 'Active tab:', tab.id, tab.url);

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

      debugLog('SidePanel', 'System prompt length:', systemContent.length);

      // Create LangChain Agent
      infoLog('SidePanel', 'Creating LangChain Agent...');
      const agent = createAgentForTab(
        apiKey,
        baseUrl || "https://api.openai.com/v1",
        model,
        temperature,
        tab.id,
        systemContent
      );

      debugLog('SidePanel', 'Agent created');

      setStatusText("正在生成...");

      // Track tool call info for UI
      let currentToolCalls: ToolCallInfo[] = [];
      let hasToolCalls = false;

      // Stream agent response with automatic multi-round tool calling
      try {
        infoLog('SidePanel', 'Starting agent stream...');
        const stream = streamAgentResponse(agent, currentInput, controller.signal);

        for await (const chunk of stream) {
          if (controller.signal.aborted) {
            debugLog('SidePanel', 'Stream aborted');
            break;
          }

          if (chunk.type === "tool_call") {
            // Handle tool calls
            const toolCalls = chunk.data as { name: string; args: Record<string, unknown> }[];
            infoLog('SidePanel', 'Received tool calls:', toolCalls.length);

            // Show tool call info
            if (!hasToolCalls) {
              // First batch of tool calls
              hasToolCalls = true;
              currentToolCalls = toolCalls.map((tc, index) => ({
                id: `${generateMsgId()}-${tc.name}-${index}`,
                name: tc.name,
                status: "running" as const,
              }));
              updateMessage(assistantMsgId, {
                content: "",
                metadata: { toolCallInfos: currentToolCalls },
                isStreaming: false,
              });
            } else {
              // Additional tool calls - create new message
              const additionalToolCalls = toolCalls.map((tc, index) => ({
                id: `${generateMsgId()}-${tc.name}-${index}`,
                name: tc.name,
                status: "running" as const,
              }));
              const additionalMsgId = generateMsgId();
              addMessage({
                id: additionalMsgId,
                role: "assistant",
                content: "",
                timestamp: Date.now(),
                metadata: { toolCallInfos: additionalToolCalls },
              });
              currentToolCalls = [...currentToolCalls, ...additionalToolCalls];
            }

            setStatusText("正在分析页面...");
          } else if (chunk.type === "content") {
            // Handle content
            if (hasToolCalls) {
              // Create new message for final response after tool calls
              const finalMsgId = generateMsgId();
              addMessage({
                id: finalMsgId,
                role: "assistant",
                content: chunk.data as string,
                timestamp: Date.now(),
                isStreaming: true,
              });
              setStreamingMessageId(finalMsgId);
              hasToolCalls = false;
            } else {
              // Direct content
              appendToMessage(assistantMsgId, chunk.data as string);
            }
          }
        }

        infoLog('SidePanel', 'Agent stream complete');
      } catch (streamError: any) {
        errorLog('SidePanel', 'Stream error:', streamError);
        if (assistantMsgId) {
          appendToMessage(assistantMsgId, "\n[流式响应中断: " + (streamError.message || "未知错误") + "]");
        }
      }

      // Mark streaming as complete
      if (streamingMessageId) {
        setMessageStreaming(streamingMessageId, false);
      } else {
        setMessageStreaming(assistantMsgId, false);
      }
    } catch (error: any) {
      errorLog('SidePanel', 'Error in handleSendMessage:', error);
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
      infoLog('SidePanel', 'Message handling complete');
    }
  };

  const handleStop = () => {
    debugLog('SidePanel', 'Stopping generation');
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
        onNewSession={handleNewSession}
        onOpenSettings={() => {
          const el = document.getElementById("api-config");
          if (el) el.classList.toggle("hidden");
        }}
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
            isPicking={isPicking}
            apiKey={apiKey}
            onSend={handleSendMessage}
            onStop={handleStop}
            onStartPicking={handleStartPicking}
          />
        </>
      ) : (
        <NetworkTab requests={networkRequests} responses={networkResponses} />
      )}
    </div>
  );
}

export default SidePanel;
