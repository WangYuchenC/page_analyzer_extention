import { RefreshCw, Copy, Check } from "lucide-react";
import type { ChatMessage, ToolCallInfo } from "~types";
import { useState } from "react";

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

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  // Strip the language identifier from the first line for copying
  const codeLines = code.split("\n");
  const codeToCopy = codeLines.length > 1 && codeLines[0].trim().match(/^[a-zA-Z0-9_+#-]+$/)
    ? codeLines.slice(1).join("\n")
    : code;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(codeToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may not be available
    }
  };

  return (
    <div className="relative group my-2">
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 rounded bg-gray-700 text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-gray-600 hover:text-white"
        title="复制代码"
      >
        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
      <pre className="bg-gray-900 text-gray-100 p-2 rounded overflow-x-auto">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function parseMarkdown(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  const renderInlineMarkdown = (text: string): React.ReactNode[] => {
    const result: React.ReactNode[] = [];
    let remaining = text;
    
    while (remaining.length > 0) {
      let matched = false;

      const boldMatch = remaining.match(/^\*\*(.+?)\*\*/);
      if (boldMatch) {
        result.push(<strong key={`bold-${key++}`} className="font-bold">{boldMatch[1]}</strong>);
        remaining = remaining.slice(boldMatch[0].length);
        matched = true;
        continue;
      }

      const italicMatch = remaining.match(/^\*(.+?)\*/);
      if (italicMatch) {
        result.push(<em key={`italic-${key++}`} className="italic">{italicMatch[1]}</em>);
        remaining = remaining.slice(italicMatch[0].length);
        matched = true;
        continue;
      }

      const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        result.push(<a key={`link-${key++}`} href={linkMatch[2]} className="text-primary-600 underline hover:text-primary-700" target="_blank" rel="noopener noreferrer">{linkMatch[1]}</a>);
        remaining = remaining.slice(linkMatch[0].length);
        matched = true;
        continue;
      }

      const inlineCodeMatch = remaining.match(/^`([^`]+)`/);
      if (inlineCodeMatch) {
        result.push(<code key={`code-${key++}`} className="bg-gray-100 px-1 rounded text-primary-700 font-mono text-sm">{inlineCodeMatch[1]}</code>);
        remaining = remaining.slice(inlineCodeMatch[0].length);
        matched = true;
        continue;
      }

      if (!matched) {
        const nextSpecial = Math.min(
          remaining.indexOf('**') === -1 ? Infinity : remaining.indexOf('**'),
          remaining.indexOf('*') === -1 ? Infinity : remaining.indexOf('*'),
          remaining.indexOf('[') === -1 ? Infinity : remaining.indexOf('['),
          remaining.indexOf('`') === -1 ? Infinity : remaining.indexOf('`')
        );

        if (nextSpecial === Infinity) {
          result.push(remaining);
          remaining = '';
        } else {
          result.push(remaining.slice(0, nextSpecial));
          remaining = remaining.slice(nextSpecial);
        }
      }
    }

    return result;
  };

  const lines = remaining.split('\n');
  let inTable = false;
  let tableRows: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.startsWith('---') && line.trim() === '---') {
      parts.push(<hr key={`hr-${key++}`} className="my-2 border-gray-300" />);
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const HeadingTag = `h${Math.min(level, 6)}` as keyof JSX.IntrinsicElements;
      parts.push(<HeadingTag key={`heading-${key++}`} className={`font-semibold mt-2 mb-1 ${level === 1 ? 'text-lg' : level === 2 ? 'text-base' : 'text-sm'}`}>{renderInlineMarkdown(headingMatch[2])}</HeadingTag>);
      continue;
    }

    if (line.match(/^\|.*\|$/)) {
      if (!inTable) {
        inTable = true;
        tableRows = [];
      }
      tableRows.push(line);
      continue;
    }

    if (inTable) {
      inTable = false;
      const headerRow = tableRows[0]?.split('|').filter(cell => cell.trim() !== '');
      const separatorRow = tableRows[1];
      const bodyRows = tableRows.slice(separatorRow?.match(/^[|: -]+$/) ? 2 : 1);

      if (headerRow) {
        parts.push(
          <table key={`table-${key++}`} className="w-full text-xs border-collapse my-2">
            <thead>
              <tr className="bg-gray-100">
                {headerRow.map((cell, idx) => (
                  <th key={idx} className="border border-gray-300 px-2 py-1 font-medium text-left">{renderInlineMarkdown(cell.trim())}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, rowIdx) => {
                const cells = row.split('|').filter(cell => cell.trim() !== '');
                return (
                  <tr key={rowIdx} className="hover:bg-gray-50">
                    {cells.map((cell, cellIdx) => (
                      <td key={cellIdx} className="border border-gray-300 px-2 py-1">{renderInlineMarkdown(cell.trim())}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        );
      }
      tableRows = [];
    }

    const listMatch = line.match(/^(\s*)([-*+])\s+(.+)/);
    if (listMatch) {
      const content = renderInlineMarkdown(listMatch[3]);
      const indent = listMatch[1].length;
      if (indent === 0) {
        parts.push(<li key={`li-${key++}`} className="ml-4 list-disc">{content}</li>);
      } else if (indent < 4) {
        parts.push(<li key={`li-${key++}`} className="ml-8 list-disc">{content}</li>);
      } else {
        parts.push(<li key={`li-${key++}`} className="ml-12 list-disc">{content}</li>);
      }
      continue;
    }

    const numberedMatch = line.match(/^(\s*\d+\.)\s+(.+)/);
    if (numberedMatch) {
      parts.push(<li key={`num-li-${key++}`} className="ml-4 list-decimal">{renderInlineMarkdown(numberedMatch[2])}</li>);
      continue;
    }

    if (line.trim() === '') {
      parts.push(<br key={`br-${key++}`} />);
    } else {
      parts.push(<p key={`p-${key++}`} className="mb-1">{renderInlineMarkdown(line)}</p>);
    }
  }

  if (inTable && tableRows.length > 0) {
    const headerRow = tableRows[0]?.split('|').filter(cell => cell.trim() !== '');
    const separatorRow = tableRows[1];
    const bodyRows = tableRows.slice(separatorRow?.match(/^[|: -]+$/) ? 2 : 1);

    if (headerRow) {
      parts.push(
        <table key={`table-${key++}`} className="w-full text-xs border-collapse my-2">
          <thead>
            <tr className="bg-gray-100">
              {headerRow.map((cell, idx) => (
                <th key={idx} className="border border-gray-300 px-2 py-1 font-medium text-left">{renderInlineMarkdown(cell.trim())}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bodyRows.map((row, rowIdx) => {
              const cells = row.split('|').filter(cell => cell.trim() !== '');
              return (
                <tr key={rowIdx} className="hover:bg-gray-50">
                  {cells.map((cell, cellIdx) => (
                    <td key={cellIdx} className="border border-gray-300 px-2 py-1">{renderInlineMarkdown(cell.trim())}</td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      );
    }
  }

  return parts;
}

function MessageContent({
  content,
  isStreaming,
}: {
  content: string;
  isStreaming?: boolean;
}) {
  const parts: React.ReactNode[] = [];
  const codeBlocks = content.split("```");
  
  for (let i = 0; i < codeBlocks.length; i++) {
    if (i % 2 === 1) {
      parts.push(<CodeBlock key={`code-${i}`} code={codeBlocks[i]} />);
    } else {
      parts.push(<span key={`md-${i}`}>{parseMarkdown(codeBlocks[i])}</span>);
    }
  }

  return (
    <div className="whitespace-pre-wrap">
      {parts}
      {isStreaming && (
        <span className="inline-block w-2 h-4 bg-gray-600 animate-blink ml-0.5" />
      )}
    </div>
  );
}
