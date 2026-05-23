import { useEffect, useRef, useState } from "react";
import {
  MousePointer,
  Camera,
  Code,
  Bug,
  Send,
  Loader2,
  X,
  Globe,
  FileCode,
  Network,
  Settings,
  ChevronDown
} from "lucide-react";
import { MessageType, type ElementInfo, type ChatMessage, type NetworkRequest, type NetworkResponse } from "~types";
import { sendMessage, addMessageListener } from "~utils/messaging";
import { useAppStore } from "~store/app-store";
import "../style.css";

async function sendToContentScript<T = unknown>(
  tabId: number,
  message: { type: MessageType; payload?: unknown }
): Promise<T> {
  try {
    return await chrome.tabs.sendMessage(tabId, message)
  } catch {
    // Content script not injected — inject it programmatically, then retry
    const manifest = chrome.runtime.getManifest()
    const jsFiles = manifest.content_scripts?.[0]?.js
    if (jsFiles) {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: jsFiles
      })
    }
    return await chrome.tabs.sendMessage(tabId, message)
  }
}

function SidePanel() {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isPicking, setIsPicking] = useState(false);
  const [isDebuggerAttached, setIsDebuggerAttached] = useState(false);
  const [activeTab, setActiveTab] = useState<"chat" | "network">("chat");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const {
    messages,
    addMessage,
    selectedElement,
    setSelectedElement,
    screenshot,
    setScreenshot,
    pageHtml,
    setPageHtml,
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
    const unsubscribe1 = addMessageListener<ElementInfo>(
      MessageType.ELEMENT_SELECTED,
      (element) => {
        setSelectedElement(element);
        setIsPicking(false);
        const message: ChatMessage = {
          id: Date.now().toString(),
          role: "assistant",
          content: `已选择元素: \`${element.tagName}\`\n\n**XPath:** \`${element.xpath}\`\n**CSS Selector:** \`${element.cssSelector}\`\n\n**内容预览:**\n\`\`\`\n${element.innerText.slice(0, 200)}\n\`\`\``,
          timestamp: Date.now(),
          metadata: { elementInfo: element }
        };
        addMessage(message);
      }
    );

    const unsubscribe2 = addMessageListener<NetworkRequest>(
      MessageType.NETWORK_REQUEST,
      (request) => {
        addNetworkRequest(request);
      }
    );

    const unsubscribe3 = addMessageListener<NetworkResponse>(
      MessageType.NETWORK_RESPONSE,
      (response) => {
        addNetworkResponse(response);
      }
    );

    return () => {
      unsubscribe1();
      unsubscribe2();
      unsubscribe3();
    };
  }, [addMessage, setSelectedElement, addNetworkRequest, addNetworkResponse]);

  const handleStartPicking = async () => {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;

      await sendToContentScript(tab.id, {
        type: MessageType.ELEMENT_HIGHLIGHT,
        payload: { active: true }
      });
      setIsPicking(true);
    } catch (error) {
      console.error("Failed to start picking:", error);
    }
  };

  const handleCaptureScreenshot = async () => {
    try {
      setIsLoading(true);
      const response = await sendMessage(MessageType.CAPTURE_SCREENSHOT, {});
      if (response?.screenshot) {
        setScreenshot(response.screenshot);
        const message: ChatMessage = {
          id: Date.now().toString(),
          role: "assistant",
          content: "已捕获页面截图",
          timestamp: Date.now(),
          metadata: { screenshot: response.screenshot }
        };
        addMessage(message);
      }
    } catch (error) {
      console.error("Failed to capture screenshot:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGetPageHtml = async () => {
    try {
      setIsLoading(true);
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;

      const response = await sendToContentScript<{ html: string; title: string; url: string }>(tab.id, {
        type: MessageType.GET_PAGE_HTML
      });

      if (response?.html) {
        setPageHtml(response.html);
        const message: ChatMessage = {
          id: Date.now().toString(),
          role: "assistant",
          content: `已获取页面 HTML (${response.html.length} 字符)`,
          timestamp: Date.now(),
          metadata: { htmlSnippet: response.html.slice(0, 500) }
        };
        addMessage(message);
      }
    } catch (error) {
      console.error("Failed to get page HTML:", error);
    } finally {
      setIsLoading(false);
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
          timestamp: Date.now()
        };
        addMessage(message);
      }
    } catch (error) {
      console.error("Failed to toggle debugger:", error);
    }
  };

  const handleSendMessage = async () => {
    if (!input.trim() || !apiKey) return;

    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: "user",
      content: input,
      timestamp: Date.now()
    };
    addMessage(userMessage);
    setInput("");
    setIsLoading(true);

    try {
      const contextParts: string[] = [];
      if (selectedElement) {
        contextParts.push(`Selected Element:\nTag: ${selectedElement.tagName}\nXPath: ${selectedElement.xpath}\nCSS: ${selectedElement.cssSelector}\nText: ${selectedElement.innerText.slice(0, 200)}`);
      }
      if (pageHtml) {
        contextParts.push(`Page HTML (truncated):\n${pageHtml.slice(0, 3000)}`);
      }

      const userContent: string | object[] = contextParts.length > 0
        ? `${contextParts.join("\n\n")}\n\nUser question: ${input}`
        : input;

      const messages_for_llm = [
        {
          role: "system",
          content: `You are a web scraping assistant. Help users analyze web pages and generate scraping code.
When users select elements or ask about data extraction, provide specific CSS selectors or XPath expressions.
Generate Python code using requests/bs4 or Playwright when appropriate.`
        },
        {
          role: "user",
          content: screenshot
            ? [
                { type: "text", text: userContent },
                { type: "image_url", image_url: { url: screenshot } }
              ]
            : userContent
        }
      ];

      const response = await fetch(`${baseUrl || 'https://api.openai.com/v1'}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: model,
          messages: messages_for_llm,
          max_tokens: 2000,
        }),
      });

      if (!response.ok) {
        let detail = ''
        try {
          const err = await response.json()
          detail = err.error?.message || JSON.stringify(err)
        } catch {
          detail = response.statusText
        }
        throw new Error(`API error: ${response.status} — ${detail}`);
      }

      const data = await response.json();
      const content = data.choices?.[0]?.message?.content || "No response";

      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content,
        timestamp: Date.now()
      };
      addMessage(assistantMessage);
    } catch (error) {
      console.error("Failed to get LLM response:", error);
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: "assistant",
        content: `Error: ${(error as Error).message}`,
        timestamp: Date.now()
      };
      addMessage(errorMessage);
    } finally {
      setIsLoading(false);
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

      {!apiKey && (
        <div className="bg-yellow-50 border-b border-yellow-200 px-4 py-3 space-y-2">
          <label className="block text-sm font-medium text-yellow-800 mb-1">
            API 配置
          </label>
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
              const el = document.getElementById('api-config')
              if (el) el.classList.toggle('hidden')
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

      <div className="flex gap-2 p-3 bg-white border-b border-gray-200">
        <button
          onClick={handleStartPicking}
          disabled={isPicking}
          className={`flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded text-sm font-medium transition-colors ${
            isPicking
              ? "bg-primary-100 text-primary-700"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
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
            isDebuggerAttached
              ? "bg-red-100 text-red-700 hover:bg-red-200"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          <Bug className="w-4 h-4" />
          {isDebuggerAttached ? "停止" : "调试"}
        </button>
      </div>

      {activeTab === "chat" ? (
        <>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="text-center text-gray-500 py-8">
                <Globe className="w-12 h-12 mx-auto mb-3 text-gray-300" />
                <p className="text-sm">欢迎使用 Page Analyzer</p>
                <p className="text-xs mt-1">选择页面元素或截图，与 AI 对话生成爬虫代码</p>
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
                  <div className="whitespace-pre-wrap">
                    {msg.content.split("```").map((part, index) => {
                      if (index % 2 === 1) {
                        return (
                          <pre key={index} className="bg-gray-900 text-gray-100 p-2 rounded my-2 overflow-x-auto">
                            <code>{part}</code>
                          </pre>
                        );
                      }
                      return part.split("`").map((inline, i) => {
                        if (i % 2 === 1) {
                          return <code key={i} className="bg-gray-100 px-1 rounded text-primary-700">{inline}</code>;
                        }
                        return inline;
                      });
                    })}
                  </div>
                  {msg.metadata?.screenshot && (
                    <img
                      src={msg.metadata.screenshot}
                      alt="Screenshot"
                      className="mt-2 rounded max-w-full"
                    />
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

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
              <button
                onClick={handleSendMessage}
                disabled={!input.trim() || !apiKey || isLoading}
                className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <Send className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="p-3 space-y-2">
            {networkRequests.length === 0 ? (
              <div className="text-center text-gray-500 py-8 text-sm">
                <Network className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                暂无网络请求
              </div>
            ) : (
              networkRequests.map((req) => {
                const response = networkResponses.find(r => r.requestId === req.requestId);
                return (
                  <div key={req.requestId} className="bg-white border border-gray-200 rounded p-3 text-xs">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`px-1.5 py-0.5 rounded font-medium ${
                        req.method === 'GET' ? 'bg-green-100 text-green-700' :
                        req.method === 'POST' ? 'bg-blue-100 text-blue-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                        {req.method}
                      </span>
                      <span className="text-gray-600 truncate flex-1">{req.url}</span>
                    </div>
                    {response && (
                      <div className="flex items-center gap-2 text-gray-500">
                        <span className={`px-1.5 py-0.5 rounded ${
                          response.status < 300 ? 'bg-green-50 text-green-600' :
                          response.status < 400 ? 'bg-yellow-50 text-yellow-600' :
                          'bg-red-50 text-red-600'
                        }`}>
                          {response.status}
                        </span>
                        {response.body && (
                          <span className="text-gray-400">
                            {response.body.length} bytes
                          </span>
                        )}
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
