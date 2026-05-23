import { MessageType } from '~types';
import type { ToolCall, ToolDefinition, StreamChunk } from '~types';

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'query_selector',
      description: 'Query the page DOM using a CSS selector. Returns text content, HTML, and attributes of matching elements.',
      parameters: {
        type: 'object',
        properties: {
          selector: {
            type: 'string',
            description: 'CSS selector to query (e.g., "div.price", "#main p")',
          },
          maxResults: {
            type: 'integer',
            description: 'Maximum number of elements to return (default 5, max 20)',
            default: 5,
          },
          includeHtml: {
            type: 'boolean',
            description: 'Whether to include innerHTML in results (default false)',
            default: false,
          },
        },
        required: ['selector'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_page',
      description: 'Full-text search on the visible text content of the page. Returns matching lines with surrounding context.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Text to search for (case-insensitive). Can be plain text or regex pattern.',
          },
          maxResults: {
            type: 'integer',
            description: 'Maximum number of matches to return (default 10, max 30)',
            default: 10,
          },
          contextChars: {
            type: 'integer',
            description: 'Number of surrounding characters per match (default 80)',
            default: 80,
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_page_info',
      description: 'Get basic information about the current page: URL, title, meta description, language.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_selected_element',
      description: 'Get detailed information about the currently selected element (if any). The user must have selected an element first via the element picker.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
];

export function accumulateToolCallDeltas(
  existing: ToolCall[] | null,
  deltas: NonNullable<StreamChunk['choices'][0]['delta']['tool_calls']>
): ToolCall[] {
  const result = existing ? [...existing] : [];
  for (const delta of deltas) {
    if (!result[delta.index]) {
      result[delta.index] = {
        id: delta.id || '',
        type: 'function',
        function: { name: '', arguments: '' },
      };
    }
    if (delta.id) result[delta.index].id = delta.id;
    if (delta.function?.name) result[delta.index].function.name += delta.function.name;
    if (delta.function?.arguments) result[delta.index].function.arguments += delta.function.arguments;
  }
  return result;
}

export function getToolCallArgs(args: string): Record<string, unknown> {
  try {
    return JSON.parse(args);
  } catch {
    return {};
  }
}

export function buildSystemPrompt(pageSummary: string, hasTools: boolean): string {
  const toolSection = hasTools
    ? `
## Available Tools
You have access to tools to analyze the page:
- query_selector(css_selector): Query DOM elements and get their text/attributes
- search_page(query): Search visible page text for keywords or patterns
- get_page_info(): Get page metadata
- get_selected_element(): Get details of the user's selected element

Use these tools when you need information beyond what's in the page summary.`
    : '';

  return `You are a web scraping assistant. Help users analyze web pages and generate scraping code.

## Page Context
${pageSummary}${toolSection}

## Guidelines
- Use tools to investigate the page when you need details beyond the summary
- When the user asks to extract or retrieve specific information from the page, use your tools to get the data and present it directly in a clear readable format — do NOT just generate code
- When the user asks for scraping code or a reusable solution, generate Python code using requests/bs4 or Playwright
- Prefer CSS selectors over XPath when generating code
- If the user hasn't provided enough context, use your tools to find it`;
}
