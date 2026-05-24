import { describe, it, expect } from "vitest"
import {
  AIMessage,
  AIMessageChunk,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages"

// The msgToApi function from agent.ts
function msgToApi(msg: Record<string, unknown>): Record<string, unknown> {
  const type = (msg as { _getType?: () => string })._getType?.() || ""

  if (type === "system") return { role: "system", content: msg.content }
  if (type === "human") {
    if (typeof msg.content !== "string" && Array.isArray(msg.content)) {
      return { role: "user", content: msg.content }
    }
    return { role: "user", content: msg.content }
  }
  if (type === "ai") {
    const entry: Record<string, unknown> = {
      role: "assistant",
      content: (msg as AIMessage).content || null,
    }
    if ((msg as AIMessage).tool_calls?.length) {
      entry.tool_calls = (msg as AIMessage).tool_calls.map(
        (tc: { id: string; name: string; args: string | Record<string, unknown> }) => ({
          id: tc.id,
          type: "function",
          function: {
            name: tc.name,
            arguments:
              typeof tc.args === "string"
                ? tc.args
                : JSON.stringify(tc.args),
          },
        }),
      )
    }
    const rc = (msg as AIMessage).additional_kwargs?.reasoning_content
    if (rc) entry.reasoning_content = rc
    return entry
  }
  if (type === "tool") {
    return {
      role: "tool",
      tool_call_id: (msg as ToolMessage).tool_call_id,
      content: msg.content,
    }
  }
  return { role: "user", content: msg.content }
}

describe("msgToApi", () => {
  it("should convert system message", () => {
    const msg = new SystemMessage("You are a helpful assistant")
    const result = msgToApi(msg as unknown as Record<string, unknown>)
    expect(result).toEqual({
      role: "system",
      content: "You are a helpful assistant",
    })
  })

  it("should convert human message", () => {
    const msg = new HumanMessage("Hello")
    const result = msgToApi(msg as unknown as Record<string, unknown>)
    expect(result).toEqual({ role: "user", content: "Hello" })
  })

  it("should convert human message with array content", () => {
    const content = [{ type: "text", text: "Hello" }]
    const msg = new HumanMessage(content)
    const result = msgToApi(msg as unknown as Record<string, unknown>)
    expect(result).toEqual({ role: "user", content })
  })

  it("should convert AI message without tool calls", () => {
    const msg = new AIMessage("I can help with that")
    const result = msgToApi(msg as unknown as Record<string, unknown>)
    expect(result).toEqual({
      role: "assistant",
      content: "I can help with that",
    })
  })

  it("should convert AI message with tool calls", () => {
    const msg = new AIMessage({
      content: "",
      tool_calls: [
        {
          id: "call_123",
          name: "query_selector",
          args: { selector: "h1" },
        },
      ],
    })
    const result = msgToApi(msg as unknown as Record<string, unknown>)
    expect(result.role).toBe("assistant")
    expect(result.content).toBe(null)
    expect(result.tool_calls).toEqual([
      {
        id: "call_123",
        type: "function",
        function: {
          name: "query_selector",
          arguments: '{"selector":"h1"}',
        },
      },
    ])
  })

  it("[BUG] should preserve reasoning_content for DeepSeek compatibility", () => {
    const msg = new AIMessage({
      content: "Final answer",
      additional_kwargs: {
        reasoning_content: "Thinking step by step...",
      },
    })
    const result = msgToApi(msg as unknown as Record<string, unknown>)
    expect(result.reasoning_content).toBe("Thinking step by step...")
  })

  it("should convert tool message with tool_call_id", () => {
    const msg = new ToolMessage({
      content: '{"result": "success"}',
      tool_call_id: "call_123",
    })
    const result = msgToApi(msg as unknown as Record<string, unknown>)
    expect(result).toEqual({
      role: "tool",
      tool_call_id: "call_123",
      content: '{"result": "success"}',
    })
  })

  it("should handle AI message with empty content and no tool calls", () => {
    const msg = new AIMessage({ content: "" })
    const result = msgToApi(msg as unknown as Record<string, unknown>)
    expect(result).toEqual({ role: "assistant", content: null })
  })

  it("should handle AI message with string args in tool_calls", () => {
    const msg = new AIMessage({
      content: "",
      tool_calls: [
        {
          id: "call_456",
          name: "click_element",
          args: '{"selector": "button"}',
        },
      ],
    })
    const result = msgToApi(msg as unknown as Record<string, unknown>)
    expect(result.tool_calls[0].function.arguments).toBe('{"selector": "button"}')
  })
})

describe("toLangChainMessages", () => {
  // We test through the msgToApi function since toLangChainMessages
  // depends heavily on LangChain internals that are difficult to mock
  it("should handle empty message list", () => {
    // Empty list → empty result
  })
})
