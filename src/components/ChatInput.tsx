import { Send, X, MousePointer } from "lucide-react";

interface ChatInputProps {
  input: string;
  setInput: (value: string) => void;
  isLoading: boolean;
  isPicking: boolean;
  apiKey: string;
  onSend: () => void;
  onStop: () => void;
  onStartPicking: () => void;
}

export default function ChatInput({
  input,
  setInput,
  isLoading,
  isPicking,
  apiKey,
  onSend,
  onStop,
  onStartPicking,
}: ChatInputProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  return (
    <div className="border-t border-gray-200 bg-white p-3">
      <div className="flex gap-2">
        <button
          onClick={onStartPicking}
          disabled={isPicking || isLoading}
          className={`flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            isPicking
              ? "bg-primary-600 text-white"
              : "bg-gray-100 text-gray-700 hover:bg-gray-200"
          }`}
        >
          <MousePointer className="w-4 h-4" />
          {isPicking ? "选择中..." : "选择"}
        </button>
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
            onClick={onStop}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        ) : (
          <button
            onClick={onSend}
            disabled={!input.trim() || !apiKey}
            className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Send className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
}