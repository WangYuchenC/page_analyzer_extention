import { describe, it, expect } from "vitest"

// Copied implementations from agent.ts
function validateRequired(
  args: Record<string, unknown>,
  required: string[],
): string | null {
  const missing = required.filter(
    (key) => args[key] === undefined || args[key] === null,
  )
  if (missing.length > 0) {
    return `Missing required parameters: ${missing.join(", ")}`
  }
  return null
}

function validateString(
  args: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    if (args[key] !== undefined && typeof args[key] !== "string") {
      return `Parameter "${key}" must be a string`
    }
  }
  return null
}

function validateNumber(
  args: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    if (args[key] !== undefined && typeof args[key] !== "number") {
      return `Parameter "${key}" must be a number`
    }
  }
  return null
}

describe("validateRequired", () => {
  it("should return null when all required fields are present", () => {
    expect(validateRequired({ selector: "h1", text: "hello" }, ["selector", "text"])).toBeNull()
  })

  it("should return error message when a required field is missing", () => {
    const result = validateRequired({ selector: "h1" }, ["selector", "text"])
    expect(result).toBe("Missing required parameters: text")
  })

  it("should return error for missing fields (undefined)", () => {
    const result = validateRequired({ selector: undefined }, ["selector"])
    expect(result).toBe("Missing required parameters: selector")
  })

  it("should return error for null fields", () => {
    const result = validateRequired({ selector: null }, ["selector"])
    expect(result).toBe("Missing required parameters: selector")
  })

  it("should handle empty required array", () => {
    expect(validateRequired({}, [])).toBeNull()
  })

  it("should list all missing fields", () => {
    const result = validateRequired({}, ["a", "b", "c"])
    expect(result).toBe("Missing required parameters: a, b, c")
  })

  it("should accept empty string as valid", () => {
    expect(validateRequired({ selector: "" }, ["selector"])).toBeNull()
  })

  it("should accept zero as valid", () => {
    expect(validateRequired({ count: 0 }, ["count"])).toBeNull()
  })

  it("should accept false as valid", () => {
    expect(validateRequired({ flag: false }, ["flag"])).toBeNull()
  })
})

describe("validateString", () => {
  it("should return null when all values are strings", () => {
    expect(validateString({ selector: "h1", text: "hello" }, ["selector", "text"])).toBeNull()
  })

  it("should return error when a value is not a string", () => {
    const result = validateString({ selector: 123 }, ["selector"])
    expect(result).toBe('Parameter "selector" must be a string')
  })

  it("should return error for number values", () => {
    const result = validateString({ count: 42 }, ["count"])
    expect(result).toBe('Parameter "count" must be a string')
  })

  it("should return error for boolean values", () => {
    const result = validateString({ flag: true }, ["flag"])
    expect(result).toBe('Parameter "flag" must be a string')
  })

  it("should return error for null values", () => {
    const result = validateString({ name: null }, ["name"])
    expect(result).toBe('Parameter "name" must be a string')
  })

  it("should pass when key is not present (undefined)", () => {
    expect(validateString({}, ["optional"])).toBeNull()
  })

  it("should accept empty string", () => {
    expect(validateString({ text: "" }, ["text"])).toBeNull()
  })
})

describe("validateNumber", () => {
  it("should return null when all values are numbers", () => {
    expect(validateNumber({ maxResults: 10, limit: 20 }, ["maxResults", "limit"])).toBeNull()
  })

  it("should return error when a value is not a number", () => {
    const result = validateNumber({ maxResults: "10" }, ["maxResults"])
    expect(result).toBe('Parameter "maxResults" must be a number')
  })

  it("should return error for boolean", () => {
    const result = validateNumber({ count: true }, ["count"])
    expect(result).toBe('Parameter "count" must be a number')
  })

  it("should accept zero", () => {
    expect(validateNumber({ count: 0 }, ["count"])).toBeNull()
  })

  it("should accept negative numbers", () => {
    expect(validateNumber({ offset: -5 }, ["offset"])).toBeNull()
  })

  it("should pass when key is not present", () => {
    expect(validateNumber({}, ["optional"])).toBeNull()
  })

  it("should return error for null", () => {
    const result = validateNumber({ limit: null }, ["limit"])
    expect(result).toBe('Parameter "limit" must be a number')
  })
})
