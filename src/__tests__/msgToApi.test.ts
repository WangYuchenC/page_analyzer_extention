import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages"
import { msgToApi } from "../utils/agent"
import { setupChromeMock, teardownChromeMock } from "./chrome-mock"

describe("msgToApi", () => {
  beforeEach(() => {
    setupChromeMock()
    vi.clearAllMocks()
  })

  afterEach(() => {
    teardownChromeMock()
  })

  it("should convert system message", () => {
    const msg = new SystemMessage("You are a helpful assistant")
    const result = msgToApi(msg)
    expect(result).toEqual({
      role: "system",
      content: "You are a helpful assistant",
    })
  })

  it("should convert human message", () => {
    const msg = new HumanMessage("Hello")
    const result = msgToApi(msg)
    expect(result).toEqual({ role: "user", content: "Hello" })
  })

  it("should convert human message with array content", () => {
    const content = [{ type: "text", text: "Hello" }]
    const msg = new HumanMessage(content)
    const result = msgToApi(msg)
    expect(result).toEqual({ role: "user", content })
  })

  it("should convert AI message without tool calls", () => {
    const msg = new AIMessage("I can help with that")
    const result = msgToApi(msg)
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
    const result = msgToApi(msg)
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

  it("should preserve reasoning_content for DeepSeek compatibility", () => {
    const msg = new AIMessage({
      content: "Final answer",
      additional_kwargs: {
        reasoning_content: "Thinking step by step...",
      },
    })
    const result = msgToApi(msg)
    expect(result.reasoning_content).toBe("Thinking step by step...")
  })

  it("should convert tool message with tool_call_id", () => {
    const msg = new ToolMessage({
      content: '{"result": "success"}',
      tool_call_id: "call_123",
    })
    const result = msgToApi(msg)
    expect(result).toEqual({
      role: "tool",
      tool_call_id: "call_123",
      content: '{"result": "success"}',
    })
  })

  it("should handle AI message with empty content and no tool calls", () => {
    const msg = new AIMessage({ content: "" })
    const result = msgToApi(msg)
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
    const result = msgToApi(msg)
    expect(result.tool_calls[0].function.arguments).toBe('{"selector": "button"}')
  })

  describe("convertContent", () => {
    it("should convert human message with string array content to OpenAI format", () => {
      const msg = new HumanMessage(["hello", "world"])
      const result = msgToApi(msg)
      expect(result.role).toBe("user")
      expect(result.content).toEqual([
        { type: "text", text: "hello" },
        { type: "text", text: "world" },
      ])
    })

    it("should convert human message with image_url content", () => {
      const msg = new HumanMessage([
        { type: "text", text: "What's in this image?" },
        { type: "image_url", image_url: { url: "data:image/png;base64,abc123" } },
      ])
      const result = msgToApi(msg)
      expect(result.role).toBe("user")
      expect(result.content).toHaveLength(2)
      expect((result.content as Array<Record<string, unknown>>)[0]).toEqual({
        type: "text",
        text: "What's in this image?",
      })
      expect((result.content as Array<Record<string, unknown>>)[1]).toEqual({
        type: "image_url",
        image_url: { url: "data:image/png;base64,abc123" },
      })
    })

    it("should convert image_url with string shorthand to object format", () => {
      const msg = new HumanMessage([
        { type: "image_url", image_url: "data:image/png;base64,xyz" },
      ])
      const result = msgToApi(msg)
      expect(result.role).toBe("user")
      expect((result.content as Array<Record<string, unknown>>)[0]).toEqual({
        type: "image_url",
        image_url: { url: "data:image/png;base64,xyz" },
      })
    })

    it("should pass through non-content objects unchanged", () => {
      const msg = new HumanMessage([
        { type: "text", text: "hello" },
        { custom: true, data: "test" },
      ])
      const result = msgToApi(msg)
      expect(result.role).toBe("user")
      expect((result.content as Array<Record<string, unknown>>)[0]).toEqual({
        type: "text", text: "hello",
      })
      expect((result.content as Array<Record<string, unknown>>)[1]).toEqual({
        custom: true, data: "test",
      })
    })

    it("should convert system message with array content", () => {
      const msg = new SystemMessage(["part1", "part2"])
      const result = msgToApi(msg)
      expect(result.role).toBe("system")
      expect(result.content).toEqual([
        { type: "text", text: "part1" },
        { type: "text", text: "part2" },
      ])
    })
  })
})
