import { ChatOpenAI } from "@langchain/openai";
import { DynamicTool } from "@langchain/core/tools";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import type { BaseMessage } from "@langchain/core/messages";
import { StateGraph, END } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";
import { debugLog, errorLog, infoLog } from "./logger";
import { MessageType } from "../types";
import { sendToContentScript } from "./messaging";

// Define the state interface
interface AgentState {
  messages: BaseMessage[];
  toolCalls?: any[];
}

// Create tools
export function createChromeTools(tabId: number): DynamicTool[] {
  const tools: DynamicTool[] = [
    new DynamicTool({
      name: "query_selector",
      description:
        "Query the page DOM using a CSS selector. Returns text content, HTML, and attributes of matching elements. Input: JSON with \"selector\" (string, required), \"maxResults\" (number, optional, default 5, max 20), \"includeHtml\" (boolean, optional, default false).",
      func: async (input: string) => {
        debugLog("Tool:query_selector", "Called with:", input);
        try {
          const args = input ? JSON.parse(input) : {};
          const result = await sendToContentScript(tabId, {
            type: MessageType.QUERY_SELECTOR,
            payload: args,
          });
          return JSON.stringify(result, null, 2);
        } catch (error) {
          errorLog("Tool:query_selector", "Error:", error);
          return JSON.stringify({ error: (error as Error).message });
        }
      },
    }),
    new DynamicTool({
      name: "search_page",
      description:
        "Search the visible text content of the page for a query. Returns matches with surrounding context. Input: JSON with \"query\" (string, required), \"maxResults\" (number, optional, default 10, max 30), \"contextChars\" (number, optional, default 80).",
      func: async (input: string) => {
        debugLog("Tool:search_page", "Called with:", input);
        try {
          const args = input ? JSON.parse(input) : {};
          const result = await sendToContentScript(tabId, {
            type: MessageType.SEARCH_PAGE,
            payload: args,
          });
          return JSON.stringify(result, null, 2);
        } catch (error) {
          errorLog("Tool:search_page", "Error:", error);
          return JSON.stringify({ error: (error as Error).message });
        }
      },
    }),
    new DynamicTool({
      name: "get_page_info",
      description:
        "Get basic information about the current page: URL, title, meta description, language. Input: empty JSON object {}.",
      func: async () => {
        debugLog("Tool:get_page_info", "Called");
        try {
          const result = await sendToContentScript(tabId, {
            type: MessageType.GET_PAGE_INFO,
            payload: {},
          });
          return JSON.stringify(result, null, 2);
        } catch (error) {
          errorLog("Tool:get_page_info", "Error:", error);
          return JSON.stringify({ error: (error as Error).message });
        }
      },
    }),
    new DynamicTool({
      name: "get_selected_element",
      description:
        "Get detailed information about the user's currently selected element (tag, XPath, CSS selector, text). Requires the element picker to have been used first. Input: empty JSON object {}.",
      func: async () => {
        debugLog("Tool:get_selected_element", "Called");
        try {
          const result = await sendToContentScript(tabId, {
            type: MessageType.GET_SELECTED_ELEMENT,
            payload: {},
          });
          return JSON.stringify(result, null, 2);
        } catch (error) {
          errorLog("Tool:get_selected_element", "Error:", error);
          return JSON.stringify({ error: (error as Error).message });
        }
      },
    }),
  ];

  return tools;
}

// Create the agent graph
export function createAgentGraph(
  apiKey: string,
  baseUrl: string,
  model: string,
  temperature: number,
  tabId: number,
  systemPrompt: string
) {
  infoLog("AgentGraph", "Creating agent graph", { model, tabId });

  // Create model
  const chatModel = new ChatOpenAI({
    apiKey,
    configuration: { baseURL: baseUrl },
    model,
    temperature,
    streaming: true,
  });

  // Create tools
  const tools = createChromeTools(tabId);
  const modelWithTools = chatModel.bindTools(tools);

  // Define the workflow
  const workflow = new StateGraph<AgentState>({
    channels: {
      messages: {
        value: (x: BaseMessage[], y: BaseMessage[]) => x.concat(y),
        default: () => [],
      },
    },
  });

  // Node 1: Call the model
  async function callModel(state: AgentState): Promise<Partial<AgentState>> {
    debugLog("AgentGraph", "Calling model, messages count:", state.messages.length);

    const messages = [new SystemMessage(systemPrompt), ...state.messages];
    const response = await modelWithTools.invoke(messages);

    debugLog("AgentGraph", "Model response, has tool_calls:", !!response.tool_calls?.length);

    return {
      messages: [response],
    };
  }

  // Node 2: Execute tools
  async function executeTools(state: AgentState): Promise<Partial<AgentState>> {
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;

    if (!lastMessage.tool_calls?.length) {
      return { messages: [] };
    }

    infoLog("AgentGraph", "Executing", lastMessage.tool_calls.length, "tools");

    const toolMessages: ToolMessage[] = [];

    for (const toolCall of lastMessage.tool_calls) {
      const tool = tools.find((t) => t.name === toolCall.name);

      if (!tool) {
        toolMessages.push(
          new ToolMessage({
            content: JSON.stringify({ error: `Unknown tool: ${toolCall.name}` }),
            tool_call_id: toolCall.id!,
          })
        );
        continue;
      }

      try {
        const args = typeof toolCall.args === "string" ? toolCall.args : JSON.stringify(toolCall.args);
        const result = await tool.func(args);
        toolMessages.push(
          new ToolMessage({
            content: result,
            tool_call_id: toolCall.id!,
          })
        );
      } catch (error) {
        toolMessages.push(
          new ToolMessage({
            content: JSON.stringify({ error: (error as Error).message }),
            tool_call_id: toolCall.id!,
          })
        );
      }
    }

    debugLog("AgentGraph", "Tool execution complete, results:", toolMessages.length);
    return { messages: toolMessages };
  }

  // Conditional edge: should we continue?
  function shouldContinue(state: AgentState): string {
    const lastMessage = state.messages[state.messages.length - 1] as AIMessage;

    if (lastMessage.tool_calls?.length) {
      return "tools";
    }
    return END;
  }

  // Add nodes
  workflow.addNode("agent", callModel);
  workflow.addNode("tools", executeTools);

  // Add edges
  workflow.setEntryPoint("agent");
  workflow.addConditionalEdges("agent", shouldContinue, {
    tools: "tools",
    [END]: END,
  });
  workflow.addEdge("tools", "agent");

  // Compile with memory
  const checkpointer = new MemorySaver();
  const app = workflow.compile({ checkpointer });

  return { app, tools };
}

// Stream the agent response
export async function* streamAgentResponse(
  graph: ReturnType<typeof createAgentGraph>,
  messages: BaseMessage[],
  signal: AbortSignal
): AsyncGenerator<{ type: "content" | "tool_call"; data: any }> {
  infoLog("AgentGraph", "Starting agent stream");

  try {
    const config = {
      configurable: { thread_id: "page-analyzer-session" },
      signal,
    };

    const stream = await graph.app.stream(
      { messages },
      config
    );

    for await (const chunk of stream) {
      debugLog("AgentGraph", "Received chunk:", Object.keys(chunk));

      if (chunk.agent?.messages?.length) {
        const lastMessage = chunk.agent.messages[chunk.agent.messages.length - 1];

        if (lastMessage.content) {
          yield { type: "content", data: lastMessage.content };
        }

        if (lastMessage.tool_calls?.length) {
          yield { type: "tool_call", data: lastMessage.tool_calls };
        }
      }
    }

    infoLog("AgentGraph", "Agent stream complete");
  } catch (error) {
    errorLog("AgentGraph", "Agent stream error:", error);
    throw error;
  }
}
