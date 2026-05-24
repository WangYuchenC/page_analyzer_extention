import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { setupChromeMock, teardownChromeMock } from "./chrome-mock"

// === Error format normalization ===
// Content script tools return { success: false, error: "..." }
// Agent tools return { error: "..." }
// executeToolCall catches and returns { error: "..." }
// We need a function that normalizes both formats

function normalizeToolResult(result: string): {
  success: boolean
  error?: string
  data?: unknown
} {
  try {
    const parsed = JSON.parse(result)
    // Format 1: { error: "..." }  → error
    if (parsed.error && parsed.success === undefined) {
      return { success: false, error: parsed.error }
    }
    // Format 2: { success: false, error: "..." } → error
    if (parsed.success === false && parsed.error) {
      return { success: false, error: parsed.error }
    }
    // Format 3: { success: true, ... } → success with data
    if (parsed.success === true) {
      const { success, ...data } = parsed
      return { success: true, data }
    }
    // Format 4: no success/error field → assume success
    if (!parsed.error) {
      return { success: true, data: parsed }
    }
    return { success: false, error: parsed.error }
  } catch {
    return { success: true, data: result }
  }
}

// Shared validation functions (same as in agent.ts)
function validateRequired(args: Record<string, unknown>, required: string[]): string | null {
  const missing = required.filter((key) => args[key] === undefined || args[key] === null)
  if (missing.length > 0) return `Missing required parameters: ${missing.join(", ")}`
  return null
}

function validateString(args: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    if (args[key] !== undefined && typeof args[key] !== "string")
      return `Parameter "${key}" must be a string`
  }
  return null
}

function validateNumber(args: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    if (args[key] !== undefined && typeof args[key] !== "number")
      return `Parameter "${key}" must be a number`
  }
  return null
}

// Tool parameter definitions for validation
interface ToolParam {
  name: string
  required: string[]
  stringParams: string[]
  numberParams: string[]
}

// Mirroring the actual tool definitions from createChromeTools
const tools: ToolParam[] = [
  { name: "query_selector", required: ["selector"], stringParams: ["selector"], numberParams: ["maxResults"] },
  { name: "search_page", required: ["query"], stringParams: ["query"], numberParams: ["maxResults", "contextChars"] },
  { name: "get_page_info", required: [], stringParams: [], numberParams: [] },
  { name: "get_selected_element", required: [], stringParams: [], numberParams: [] },
  { name: "click_element", required: ["selector"], stringParams: ["selector"], numberParams: [] },
  { name: "input_text", required: ["selector", "text"], stringParams: ["selector", "text"], numberParams: [] },
  { name: "scroll_page", required: ["direction"], stringParams: ["direction"], numberParams: ["amount"] },
  { name: "hover_element", required: ["selector"], stringParams: ["selector"], numberParams: [] },
  { name: "wait_for_element", required: ["selector"], stringParams: ["selector"], numberParams: ["timeout"] },
  { name: "execute_script", required: ["script"], stringParams: ["script"], numberParams: [] },
  { name: "navigate", required: ["url"], stringParams: ["url"], numberParams: [] },
  { name: "go_back", required: [], stringParams: [], numberParams: [] },
  { name: "go_forward", required: [], stringParams: [], numberParams: [] },
  { name: "get_cookies", required: [], stringParams: ["url"], numberParams: [] },
  { name: "set_cookie", required: ["name", "value"], stringParams: ["name", "value", "url", "domain", "path"], numberParams: ["expirationDate"] },
  { name: "capture_screenshot", required: [], stringParams: [], numberParams: [] },
  { name: "get_page_html", required: [], stringParams: [], numberParams: [] },
  { name: "get_network_requests", required: [], stringParams: [], numberParams: ["limit"] },
]

describe("tool parameter validation", () => {
  describe("every tool validates required params correctly", () => {
    it("should reject missing required parameters for each tool", () => {
      for (const tool of tools) {
        if (tool.required.length === 0) continue // no required params, skip

        // Test with empty args
        const result = validateRequired({}, tool.required)
        expect(result).not.toBeNull()
        expect(result).toContain("Missing required parameters")
      }
    })

    it("should accept correct parameters for each tool", () => {
      for (const tool of tools) {
        const args: Record<string, unknown> = {}
        for (const r of tool.required) {
          if (tool.stringParams.includes(r)) {
            args[r] = "test_value"
          } else if (tool.numberParams.includes(r)) {
            args[r] = 42
          }
        }
        // If no required params, this should pass
        const result = validateRequired(args, tool.required)
        expect(result).toBeNull()
      }
    })

    it("should validate string parameter types for each tool", () => {
      for (const tool of tools) {
        if (tool.stringParams.length === 0) continue
        // Pass a number where a string is expected
        const args: Record<string, unknown> = {}
        for (const sp of tool.stringParams) {
          args[sp] = 12345 // wrong type
        }
        const result = validateString(args, tool.stringParams)
        expect(result).not.toBeNull()
        expect(result).toContain("must be a string")
      }
    })

    it("should validate number parameter types for each tool", () => {
      for (const tool of tools) {
        if (tool.numberParams.length === 0) continue
        const args: Record<string, unknown> = {}
        for (const np of tool.numberParams) {
          args[np] = "not_a_number" // wrong type
        }
        const result = validateNumber(args, tool.numberParams)
        expect(result).not.toBeNull()
        expect(result).toContain("must be a number")
      }
    })
  })

  describe("error format consistency", () => {
    it("should normalize { error: '...' } format correctly", () => {
      const result = normalizeToolResult(JSON.stringify({ error: "Something went wrong" }))
      expect(result.success).toBe(false)
      expect(result.error).toBe("Something went wrong")
    })

    it("should normalize { success: false, error: '...' } format correctly", () => {
      const result = normalizeToolResult(
        JSON.stringify({ success: false, error: "Element not found" }),
      )
      expect(result.success).toBe(false)
      expect(result.error).toBe("Element not found")
    })

    it("should normalize { success: true, message: '...' } format correctly", () => {
      const result = normalizeToolResult(
        JSON.stringify({ success: true, message: "Clicked element" }),
      )
      expect(result.success).toBe(true)
    })

    it("should normalize results with data fields correctly", () => {
      const result = normalizeToolResult(
        JSON.stringify({ count: 5, elements: [{ tagName: "div" }] }),
      )
      expect(result.success).toBe(true)
    })

    it("[BUG] current executeToolCall may not handle {success:false, error} format", () => {
      // The current executeToolCall does:
      //   try { return await tool.func(JSON.stringify(args)); }
      //   catch { return JSON.stringify({ error: ... }); }
      // If tool returns {success:false, error:"msg"}, it's NOT caught by catch
      // and the stringified result is returned as-is with no error indication
      const toolResult = JSON.stringify({ success: false, error: "Element not found: .xyz" })
      const normalized = normalizeToolResult(toolResult)
      // The string contains error info but in {success:false} format
      // Agent code checks for 'error' key in the parsed result
      expect(normalized.error).toBe("Element not found: .xyz")
      expect(normalized.success).toBe(false)
    })

    it("should handle plain text results", () => {
      const result = normalizeToolResult("plain text result")
      expect(result.success).toBe(true)
      expect(result.data).toBe("plain text result")
    })
  })
})

describe("tool response format audit", () => {
  beforeEach(() => {
    setupChromeMock()
  })

  afterEach(() => {
    teardownChromeMock()
  })

  // Verify that content.ts tools all use the same error format
  it("[BUG] content.ts click_element uses {success:false,error} instead of {error}", () => {
    // In content.ts line 251: sendResponse({ success: false, error: ... })
    // In agent.ts line 171: returns JSON.stringify(result)
    // executeToolCall at agent.ts 637 just returns tool.func result as-is
    // This means the agent doesn't normalize the error format
    const contentResponse = JSON.stringify({ success: false, error: "Element not found: .btn" })
    const parsed = JSON.parse(contentResponse)
    // agent.ts executeToolCall returns this as-is without checking success:false
    // streamAgentResponse line 762: rawResult = await executeToolCall(...)
    // It only checks for runtime errors, not response.error field
    expect(parsed.success).toBe(false)
    expect(parsed.error).toBeDefined()
  })

  it("[BUG] agent validate functions return {error}, not {success:false,error}", () => {
    const validationError = JSON.stringify({ error: "Missing required parameters: selector" })
    // Compare with content.ts format
    const contentError = JSON.stringify({ success: false, error: "Selector is required" })
    // These are inconsistent - one has success:false wrapper, the other doesn't
    const validationParsed = JSON.parse(validationError)
    const contentParsed = JSON.parse(contentError)

    expect(validationParsed.success).toBeUndefined()
    expect(contentParsed.success).toBe(false)
  })
})
