import { MousePointer, Camera, FileCode, Bug } from "lucide-react";

interface ToolbarProps {
  isPicking: boolean;
  isLoading: boolean;
  isDebuggerAttached: boolean;
  onStartPicking: () => void;
  onCaptureScreenshot: () => void;
  onGetPageHtml: () => void;
  onToggleDebugger: () => void;
}

export default function Toolbar({
  isPicking,
  isLoading,
  isDebuggerAttached,
  onStartPicking,
  onCaptureScreenshot,
  onGetPageHtml,
  onToggleDebugger,
}: ToolbarProps) {
  return (
    <div className="flex gap-2 p-3 bg-white border-b border-gray-200">
      <button
        onClick={onStartPicking}
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
        onClick={onCaptureScreenshot}
        disabled={isLoading}
        className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-gray-100 text-gray-700 rounded text-sm font-medium hover:bg-gray-200 transition-colors"
      >
        <Camera className="w-4 h-4" />
        截图
      </button>
      <button
        onClick={onGetPageHtml}
        disabled={isLoading}
        className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-gray-100 text-gray-700 rounded text-sm font-medium hover:bg-gray-200 transition-colors"
      >
        <FileCode className="w-4 h-4" />
        HTML
      </button>
      <button
        onClick={onToggleDebugger}
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
  );
}
