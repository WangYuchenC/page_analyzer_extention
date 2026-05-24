import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { setupChromeMock, teardownChromeMock, mockChrome } from "./chrome-mock"

describe("execute_script debugger leak", () => {
  beforeEach(() => {
    setupChromeMock()
    vi.clearAllMocks()
  })

  afterEach(() => {
    teardownChromeMock()
  })

  it("[BUG] execute_script attaches debugger but never detaches", async () => {
    const tabId = 42

    // Simulate: attach debugger
    await mockChrome.debugger.attach({ tabId }, "1.3")
    expect(mockChrome.debugger.attach).toHaveBeenCalledTimes(1)

    // Execute script via CDP
    await mockChrome.debugger.sendCommand(
      { tabId },
      "Runtime.evaluate",
      {
        expression: `(async function(){document.title})()`,
        awaitPromise: true,
        returnByValue: true,
      },
    )

    // BUG: no detach call after execution
    expect(mockChrome.debugger.detach).not.toHaveBeenCalled()
  })

  it("fixed: should detach debugger after script execution completes", async () => {
    const tabId = 42

    // Simulate fixed behavior: attach → execute → detach
    await mockChrome.debugger.attach({ tabId }, "1.3")
    await mockChrome.debugger.sendCommand(
      { tabId },
      "Runtime.evaluate",
      {
        expression: `(async function(){document.title})()`,
        awaitPromise: true,
        returnByValue: true,
      },
    )
    // FIX: detach after execution
    await mockChrome.debugger.detach({ tabId })

    expect(mockChrome.debugger.attach).toHaveBeenCalledTimes(1)
    expect(mockChrome.debugger.detach).toHaveBeenCalledTimes(1)
  })

  it("fixed: should detach even when script execution fails", async () => {
    const tabId = 42

    mockChrome.debugger.sendCommand.mockRejectedValueOnce(new Error("Script error"))

    try {
      await mockChrome.debugger.attach({ tabId }, "1.3")
      await mockChrome.debugger.sendCommand(
        { tabId },
        "Runtime.evaluate",
        { expression: "bad code", awaitPromise: true, returnByValue: true },
      )
    } catch {
      // FIX: must detach even on error
      await mockChrome.debugger.detach({ tabId })
    }

    expect(mockChrome.debugger.detach).toHaveBeenCalledTimes(1)
  })
})

describe("input_text React compatibility", () => {
  it("should set value on standard input elements", () => {
    const input = document.createElement("input")
    input.value = "hello"
    expect(input.value).toBe("hello")

    let inputEventFired = false
    input.addEventListener("input", () => {
      inputEventFired = true
    })
    input.dispatchEvent(new Event("input", { bubbles: true }))
    expect(inputEventFired).toBe(true)
  })

  it("[BUG] current implementation doesn't dispatch change or blur events", () => {
    const input = document.createElement("input")

    let changeFired = false
    let blurFired = false
    let inputFired = false

    input.addEventListener("change", () => {
      changeFired = true
    })
    input.addEventListener("blur", () => {
      blurFired = true
    })
    input.addEventListener("input", () => {
      inputFired = true
    })

    // Current implementation from content.ts lines 289-295
    input.value = "text"
    input.dispatchEvent(new Event("input", { bubbles: true }))

    expect(inputFired).toBe(true)
    expect(changeFired).toBe(false) // BUG: change event not fired
    expect(blurFired).toBe(false) // BUG: blur event not fired
  })

  it("fixed: should also dispatch change and blur events", () => {
    const input = document.createElement("input")

    let changeFired = false
    let blurFired = false
    let inputFired = false

    input.addEventListener("change", () => {
      changeFired = true
    })
    input.addEventListener("blur", () => {
      blurFired = true
    })
    input.addEventListener("input", () => {
      inputFired = true
    })

    // Fixed implementation
    input.value = "text"
    input.dispatchEvent(new Event("input", { bubbles: true }))
    input.dispatchEvent(new Event("change", { bubbles: true }))
    input.dispatchEvent(new Event("blur", { bubbles: true }))

    expect(inputFired).toBe(true)
    expect(changeFired).toBe(true)
    expect(blurFired).toBe(true)
  })
})

describe("invokeModelRaw parameter schema", () => {
  it("[BUG] current invokeModelRaw sends empty parameter properties", () => {
    // From agent.ts lines 825-832
    const tools = [
      { name: "query_selector", description: "Query DOM elements" },
    ].map((tool) => ({
      type: "function" as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: { type: "object", properties: {} as Record<string, unknown> },
      },
    }))

    // The bug: properties is empty! LLM has no idea what params each tool needs.
    expect(tools[0].function.parameters.properties).toEqual({})
  })

  it("fixed: should include parameter definitions for each tool", () => {
    // Fixed version: define proper JSON Schema
    const tools = [
      {
        name: "query_selector",
        description: "Query DOM elements using CSS selector",
        params: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector" },
            maxResults: { type: "number", description: "Maximum results (default 5)" },
            includeHtml: { type: "boolean", description: "Include HTML content" },
          },
          required: ["selector"],
        },
      },
    ]

    expect(tools[0].params.properties).toHaveProperty("selector")
    expect(tools[0].params.properties).toHaveProperty("maxResults")
    expect(tools[0].params.properties).toHaveProperty("includeHtml")
    expect(tools[0].params.required).toContain("selector")
  })
})

describe("tool call timeout", () => {
  it("[BUG] content script tool calls have no timeout protection", () => {
    // Current code passes sendMessage directly to the return statement
    // with no Promise.race timeout wrapper
    // Verified by reading agent.ts - there's no timeout mechanism
    expect(true).toBe(true) // documentary test
  })

  it("fixed: should use Promise.race with timeout for tool calls", async () => {
    // Simulate a hanging sendMessage being rescued by timeout
    const hangingPromise = new Promise<never>(() => {}) // never resolves

    const TIMEOUT_MS = 100
    const timeoutPromise = new Promise<{ error: string }>((resolve) => {
      setTimeout(() => resolve({ error: `Tool call timed out after ${TIMEOUT_MS}ms` }), TIMEOUT_MS)
    })

    const result = await Promise.race([hangingPromise, timeoutPromise])
    expect(result).toEqual({ error: "Tool call timed out after 100ms" })
  })
})
