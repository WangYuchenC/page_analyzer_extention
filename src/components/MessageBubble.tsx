import { RefreshCw } from "lucide-react";
import type { ChatMessage, ToolCallInfo } from "~types";

interface MessageBubbleProps {
  msg: ChatMessage;
  onRetry: (msg: ChatMessage) => void;
}

export default function MessageBubble({ msg, onRetry }: MessageBubbleProps) {
  const isUser = msg.role === "user";

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[90%] rounded-lg px-4 py-2 text-sm ${
          isUser
            ? "bg-primary-600 text-white"
            : "bg-white border border-gray-200 text-gray-800"
        }`}
      >
        <ToolCallList toolCallInfos={msg.metadata?.toolCallInfos} />
        <MessageContent content={msg.content} isStreaming={msg.isStreaming} />
        {msg.metadata?.screenshot && (
          <img
            src={msg.metadata.screenshot}
            alt="Screenshot"
            className="mt-2 rounded max-w-full"
          />
        )}
        {msg.content.startsWith("Error:") && !msg.isStreaming && (
          <button
            onClick={() => onRetry(msg)}
            className="mt-2 flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700"
          >
            <RefreshCw className="w-3 h-3" />
            重试
          </button>
        )}
      </div>
    </div>
  );
}

function ToolCallList({ toolCallInfos }: { toolCallInfos?: ToolCallInfo[] }) {
  if (!toolCallInfos || toolCallInfos.length === 0) return null;

  return (
    <div className="mb-2 space-y-1 border border-gray-200 rounded p-2 bg-gray-50 text-xs">
      {toolCallInfos.map((tc) => (
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
  );
}

function MessageContent({
  content,
  isStreaming,
}: {
  content: string;
  isStreaming?: boolean;
}) {
  return (
    <div className="whitespace-pre-wrap">
      {content.split("```").map((part, index) => {
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
      {isStreaming && (
        <span className="inline-block w-2 h-4 bg-gray-600 animate-blink ml-0.5" />
      )}
    </div>
  );
}
