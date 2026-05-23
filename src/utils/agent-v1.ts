import { createAgent } from "langchain";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { MessageType } from "~types";
import { sendToContentScript } from "./messaging";
import { debugLog, errorLog, infoLog } from "./logger";
import type { PageSummary } from "~types";

// Define tool schemas using Zod
const QuerySelectorSchema = z.object({
  selector: z.string().describe("CSS selector to query elements"),
  maxResults: z.number().optional().default(5).describe("Maximum number of results to return"),
  includeHtml: z.boolean().optional().default(false).describe("Whether to include HTML content"),
});

const SearchPageSchema = z.object({
  query: z.string().describe("Search query string"),
  maxResults: z.number().optional().default(10).describe("Maximum number of results"),
  contextChars: z.number().optional().default(80).describe("Number of context characters around match"),
});

const GetPageInfoSchema = z.object({});

const GetSelectedElementSchema = z.object({});

// Create tools using the new tool() function
export function createPageAnalyzerTools(tabId: number) {
  const querySelectorTool = tool(
    async (input) => {
      debugLog("Tool:query_selector", "Executing with input:", input);
      try {
        const result = await sendToContentScript(tabId, {
          type: MessageType.QUERY_SELECTOR,
          payload: input,
        });
        debugLog("Tool:query_selector", "Result:", result);
        return JSON.stringify(result, null, 2);
      } catch (error) {
        errorLog("Tool:query_selector", "Error:", error);
        return JSON.stringify({ error: (error as Error).message });
      }
    },
    {
      name: "query_selector",
      description:
        "Query the page DOM using a CSS selector. Returns text content, HTML, and attributes of matching elements.",
      schema: QuerySelectorSchema,
    }
  );

  const searchPageTool = tool(
    async (input) => {
      debugLog("Tool:search_page", "Executing with input:", input);
      try {
        const result = await sendToContentScript(tabId, {
          type: MessageType.SEARCH_PAGE,
          payload: input,
        });
        debugLog("Tool:search_page", "Result:", result);
        return JSON.stringify(result, null, 2);
      } catch (error) {
        errorLog("Tool:search_page", "Error:", error);
        return JSON.stringify({ error: (error as Error).message });
      }
    },
    {
      name: "search_page",
      description:
        "Search the visible text content of the page for a query. Returns matches with surrounding context.",
      schema: SearchPageSchema,
    }
  );

  const getPageInfoTool = tool(
    async () => {
      debugLog("Tool:get_page_info", "Executing");
      try {
        const result = await sendToContentScript(tabId, {
          type: MessageType.GET_PAGE_INFO,
          payload: {},
        });
        debugLog("Tool:get_page_info", "Result:", result);
        return JSON.stringify(result, null, 2);
      } catch (error) {
        errorLog("Tool:get_page_info", "Error:", error);
        return JSON.stringify({ error: (error as Error).message });
      }
    },
    {
      name: "get_page_info",
      description:
        "Get basic information about the current page: URL, title, meta description, language.",
      schema: GetPageInfoSchema,
    }
  );

  const getSelectedElementTool = tool(
    async () => {
      debugLog("Tool:get_selected_element", "Executing");
      try {
        const result = await sendToContentScript(tabId, {
          type: MessageType.GET_SELECTED_ELEMENT,
          payload: {},
        });
        debugLog("Tool:get_selected_element", "Result:", result);
        return JSON.stringify(result, null, 2);
      } catch (error) {
        errorLog("Tool:get_selected_element", "Error:", error);
        return JSON.stringify({ error: (error as Error).message });
      }
    },
    {
      name: "get_selected_element",
      description:
        "Get detailed information about the user's currently selected element (tag, XPath, CSS selector, text). Requires the element picker to have been used first.",
      schema: GetSelectedElementSchema,
    }
  );

  return [querySelectorTool, searchPageTool, getPageInfoTool, getSelectedElementTool];
}

// Create the agent
export function createPageAnalyzerAgent(
  apiKey: string,
  baseUrl: string,
  model: string,
  temperature: number,
  tabId: number,
  systemPrompt: string
) {
  infoLog("Agent", "Creating Page Analyzer Agent", { model, baseUrl, tabId });

  // Create model instance
  const chatModel = new ChatOpenAI({
    apiKey,
    configuration: { baseURL: baseUrl },
    model,
    temperature,
    streaming: true,
  });

  // Create tools
  const tools = createPageAnalyzerTools(tabId);

  // Create agent using the new createAgent API
  const agent = createAgent({
    model: chatModel,
    tools,
    systemPrompt,
  });

  debugLog("Agent", "Agent created successfully");

  return agent;
}

// Format page summary for system prompt
export function formatPageSummary(summary: PageSummary): string {
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

// Build system prompt
export function buildSystemPrompt(pageContext: string, hasTools: boolean): string {
  const basePrompt = `You are a web page analysis assistant. Your task is to help users analyze web page structures and extract information.

${pageContext}

When analyzing pages:
1. Use the available tools to explore the page structure
2. Provide clear, actionable insights
3. If extracting data, format it in a structured way
4. If generating code (e.g., for web scraping), ensure it's complete and functional`;

  if (hasTools) {
    return `${basePrompt}

You have access to tools that can help you analyze the page. Use them as needed to gather information.`;
  }

  return basePrompt;
}

// Stream agent response
export async function* streamAgentResponse(
  agent: ReturnType<typeof createPageAnalyzerAgent>,
  messages: (SystemMessage | HumanMessage)[],
  signal: AbortSignal
): AsyncGenerator<string> {
  infoLog("Agent", "Starting agent stream");

  try {
    const stream = await agent.stream(
      { messages },
      { signal }
    );

    for await (const chunk of stream) {
      // Handle different chunk types from the agent
      if (typeof chunk === "string") {
        yield chunk;
      } else if (chunk && typeof chunk === "object") {
        // Handle structured chunks from the agent
        const content = extractContentFromChunk(chunk);
        if (content) {
          yield content;
        }
      }
    }

    infoLog("Agent", "Agent stream complete");
  } catch (error) {
    errorLog("Agent", "Agent stream error:", error);
    throw error;
  }
}

// Helper to extract content from agent chunks
function extractContentFromChunk(chunk: unknown): string | null {
  if (!chunk || typeof chunk !== "object") return null;

  // Handle AIMessage chunks
  if ("content" in chunk && chunk.content) {
    return String(chunk.content);
  }

  // Handle tool call chunks
  if ("tool_calls" in chunk && Array.isArray(chunk.tool_calls)) {
    // Tool calls are handled internally by the agent, we don't yield them
    return null;
  }

  // Handle message array chunks
  if ("messages" in chunk && Array.isArray(chunk.messages)) {
    const lastMessage = chunk.messages[chunk.messages.length - 1];
    if (lastMessage && "content" in lastMessage) {
      return String(lastMessage.content);
    }
  }

  return null;
}
