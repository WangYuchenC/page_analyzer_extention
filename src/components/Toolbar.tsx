import { RefreshCw, Settings } from "lucide-react";

interface ToolbarProps {
  onNewSession: () => void;
  onOpenSettings: () => void;
}

export default function Toolbar({ onNewSession, onOpenSettings }: ToolbarProps) {
  return (
    <div className="flex gap-2 p-3 bg-white border-b border-gray-200">
      <button
        onClick={onNewSession}
        className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-gray-100 text-gray-700 rounded text-sm font-medium hover:bg-gray-200 transition-colors"
      >
        <RefreshCw className="w-4 h-4" />
        新会话
      </button>
      <button
        onClick={onOpenSettings}
        className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-gray-100 text-gray-700 rounded text-sm font-medium hover:bg-gray-200 transition-colors"
      >
        <Settings className="w-4 h-4" />
        设置
      </button>
    </div>
  );
}