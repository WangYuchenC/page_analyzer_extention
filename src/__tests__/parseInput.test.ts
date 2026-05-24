import { describe, it, expect } from "vitest"

// === Current buggy implementation for reference ===
function parseInputCurrent(input: string): Record<string, unknown> {
  if (!input) return {}
  try {
    const parsed = typeof input === "string" ? JSON.parse(input) : input
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).length === 1 &&
      "input" in parsed &&
      typeof parsed.input === "string"
    ) {
      try {
        return JSON.parse(parsed.input)
      } catch {
        return parsed
      }
    }
    return parsed
  } catch {
    return {}
  }
}

// === Fixed implementation (desired behavior) ===
function parseInputFixed(input: string): Record<string, unknown> {
  if (!input) return {}
  try {
    const parsed = typeof input === "string" ? JSON.parse(input) : input
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {}
    }

    // DynamicTool + bindTools wraps args as {input: '{"key": "val"}'}
    // Only unwrap if:
    // 1. The parsed object has exactly one key called "input"
    // 2. The value of "input" is a string
    // 3. The string starts with "{" or "[" (looks like JSON structure)
    // This avoids false positives when a tool legitimately has an "input" param
    // with a plain string value like {input: "hello"} or {input: "42"}
    const keys = Object.keys(parsed)
    if (
      keys.length === 1 &&
      keys[0] === "input" &&
      typeof parsed.input === "string"
    ) {
      const trimmed = parsed.input.trim()
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        try {
          return JSON.parse(parsed.input)
        } catch {
          // Inner value looks like JSON but is invalid, return original
          return parsed
        }
      }
    }

    return parsed
  } catch {
    return {}
  }
}

describe("parseInput", () => {
  describe("basic JSON parsing (current and fixed agree)", () => {
    it("should parse a normal JSON string", () => {
      expect(parseInputCurrent('{"selector": "h1", "maxResults": 5}')).toEqual({
        selector: "h1",
        maxResults: 5,
      })
      expect(parseInputFixed('{"selector": "h1", "maxResults": 5}')).toEqual({
        selector: "h1",
        maxResults: 5,
      })
    })

    it("should return empty object for empty input", () => {
      expect(parseInputCurrent("")).toEqual({})
      expect(parseInputFixed("")).toEqual({})
    })

    it("should handle array input", () => {
      expect(parseInputCurrent('{"items": [1, 2, 3]}')).toEqual({ items: [1, 2, 3] })
      expect(parseInputFixed('{"items": [1, 2, 3]}')).toEqual({ items: [1, 2, 3] })
    })

    it("should handle nested objects", () => {
      expect(parseInputCurrent('{"nested": {"a": 1, "b": 2}}')).toEqual({
        nested: { a: 1, b: 2 },
      })
      expect(parseInputFixed('{"nested": {"a": 1, "b": 2}}')).toEqual({
        nested: { a: 1, b: 2 },
      })
    })

    it("should handle invalid JSON gracefully", () => {
      expect(parseInputCurrent("{invalid json}")).toEqual({})
      expect(parseInputFixed("{invalid json}")).toEqual({})
    })
  })

  describe("DynamicTool wrapper unwrapping", () => {
    it("should unwrap {input: '{\"key\": \"val\"}'} wrapper", () => {
      const input = '{"input": "{\\"selector\\": \\"h1\\"}"}'
      expect(parseInputCurrent(input)).toEqual({ selector: "h1" })
      expect(parseInputFixed(input)).toEqual({ selector: "h1" })
    })

    it("should unwrap nested wrapper with multiple params", () => {
      const input =
        '{"input": "{\\"selector\\": \\"input#username\\", \\"text\\": \\"hello\\"}"}'
      expect(parseInputCurrent(input)).toEqual({
        selector: "input#username",
        text: "hello",
      })
      expect(parseInputFixed(input)).toEqual({
        selector: "input#username",
        text: "hello",
      })
    })

    it("should return wrapper as-is when inner string is not valid JSON", () => {
      const input = '{"input": "just a plain string"}'
      expect(parseInputCurrent(input)).toEqual({ input: "just a plain string" })
      expect(parseInputFixed(input)).toEqual({ input: "just a plain string" })
    })

    it("should unwrap {input: '[...]'} array JSON", () => {
      const input = '{"input": "[\\"a\\", \\"b\\"]"}'
      expect(parseInputFixed(input)).toEqual(["a", "b"])
    })
  })

  describe("[BUG] false positive with legitimate 'input' parameter", () => {
    it("should NOT unwrap {input: 'numeric string'} (current fails)", () => {
      const input = '{"input": "42"}'
      // Current: JSON.parse("42") returns number 42, then returns 42 (not object!)
      const currentResult = parseInputCurrent(input)
      // This is the bug: returns 42 instead of {input: "42"}
      expect(typeof currentResult === "number" || currentResult === null).toBe(true)

      // Fixed: preserves {input: "42"} because "42" doesn't start with { or [
      expect(parseInputFixed(input)).toEqual({ input: "42" })
    })

    it("should NOT unwrap {input: 'true'} (current fails)", () => {
      const input = '{"input": "true"}'
      // Fixed: preserves {input: "true"}
      expect(parseInputFixed(input)).toEqual({ input: "true" })
    })

    it("should NOT unwrap {input: 'false'} (current fails)", () => {
      const input = '{"input": "false"}'
      expect(parseInputFixed(input)).toEqual({ input: "false" })
    })

    it("should NOT unwrap {input: 'null'} (current fails)", () => {
      const input = '{"input": "null"}'
      // Current: JSON.parse("null") returns null
      // Then the function tries to access null? No, it returns null directly
      // Actually JSON.parse("null") returns null, then it returns null
      const currentResult = parseInputCurrent(input)
      expect(currentResult).toBeNull()

      // Fixed: preserves {input: "null"}
      expect(parseInputFixed(input)).toEqual({ input: "null" })
    })

    it("should handle 'input' key with plain text value", () => {
      const input = '{"input": "hello world"}'
      expect(parseInputCurrent(input)).toEqual({ input: "hello world" })
      expect(parseInputFixed(input)).toEqual({ input: "hello world" })
    })
  })

  describe("edge cases", () => {
    it("should handle null and undefined input", () => {
      expect(parseInputCurrent(null as unknown as string)).toEqual({})
      expect(parseInputFixed(null as unknown as string)).toEqual({})
      expect(parseInputCurrent(undefined as unknown as string)).toEqual({})
      expect(parseInputFixed(undefined as unknown as string)).toEqual({})
    })

    it("should handle JSON with all data types", () => {
      const input = JSON.stringify({
        string: "text",
        number: 42,
        bool: true,
        nullVal: null,
        arr: [1, 2, 3],
      })
      expect(parseInputCurrent(input)).toEqual({
        string: "text",
        number: 42,
        bool: true,
        nullVal: null,
        arr: [1, 2, 3],
      })
      expect(parseInputFixed(input)).toEqual({
        string: "text",
        number: 42,
        bool: true,
        nullVal: null,
        arr: [1, 2, 3],
      })
    })
  })
})
