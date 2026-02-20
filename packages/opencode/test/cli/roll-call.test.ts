// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { formatTable } from "../../src/cli/cmd/roll-call"

// NOTE: We test formatTable function directly. The color() helper and TTY detection
// are not directly tested as they depend on process.stderr.isTTY which changes
// based on how the process is invoked.

describe("formatTable", () => {
  describe("column width calculation", () => {
    test("columns grow to fit content", () => {
      const rows = [["kilo/provider/model-name", "YES", "Hi", "100ms"]]
      const result = formatTable(rows, 120)

      // Model column should be wide enough for the model name
      expect(result.header).toContain("Model")
      expect(result.rows[0]).toContain("kilo/provider/model-name")
      // All columns should be present
      expect(result.rows[0]).toContain("YES")
      expect(result.rows[0]).toContain("Hi")
      expect(result.rows[0]).toContain("100ms")
    })

    test("short snippet does not force minimum width", () => {
      const rows = [["m", "YES", "Hi", "1ms"]]
      const result = formatTable(rows, 120)

      // Table should be compact when content is short
      // Header is: "Model | Access | Snippet | Latency"
      // Minimum widths are header lengths: Model=5, Access=6, Snippet=7, Latency=7
      // With separators: 5 + 6 + 7 + 7 + 9 = 34
      expect(result.header.length).toBeLessThan(50)
      expect(result.separator.length).toBe(result.header.length)
    })

    test("separator length matches header length", () => {
      const rows = [
        ["kilo/openai/gpt-4", "YES", "Hello there!", "500ms"],
        ["kilo/anthropic/claude", "NO", "(Error)", "100ms"],
      ]
      const result = formatTable(rows, 120)

      expect(result.separator.length).toBe(result.header.length)
      expect(result.separator).toMatch(/^-+$/)
    })

    test("all rows have same length as header", () => {
      const rows = [
        ["short", "YES", "Hello", "10ms"],
        ["kilo/very/long/provider/model-name", "NO", "(Some error message)", "1000ms"],
      ]
      const result = formatTable(rows, 120)

      for (const row of result.rows) {
        expect(row.length).toBe(result.header.length)
      }
    })
  })

  describe("snippet truncation", () => {
    test("long snippet is truncated with ellipsis when exceeding terminal width", () => {
      const longSnippet = "This is a very long snippet that should be truncated because it exceeds the available width"
      const rows = [["kilo/provider/model", "YES", longSnippet, "100ms"]]
      const result = formatTable(rows, 80) // narrow terminal

      expect(result.rows[0]).toContain("...")
      expect(result.rows[0].length).toBeLessThanOrEqual(80)
    })

    test("snippet is not truncated when table fits terminal width", () => {
      const snippet = "Short response"
      const rows = [["m", "YES", snippet, "1ms"]]
      const result = formatTable(rows, 120)

      expect(result.rows[0]).toContain(snippet)
      expect(result.rows[0]).not.toContain("...")
    })

    test("table fits within terminal width when content exceeds available space", () => {
      // This test reproduces the "off by 2" bug where table was 2 chars too wide
      const rows = [
        ["kilo/openrouter/free", "YES", "Le temps passe vi...", "802ms"],
        ["kilo/arcee-ai/trinity-large-preview:free", "YES", '"Le soleil brille...', "1527ms"],
        ["kilo/minimax/minimax-m2.5:free", "YES", "Voici une phrase ...", "2615ms"],
        ["kilo/stepfun/step-3.5-flash:free", "YES", "Aujourd'hui, je s...", "3561ms"],
        ["kilo/corethink:free", "NO", "(Invalid JSON res...", "18490ms"],
        ["kilo/z-ai/glm-5:free", "NO", "(The operation ti...", "25010ms"],
      ]
      const terminalWidth = 80
      const result = formatTable(rows, terminalWidth)

      // Header, separator, and all rows must fit within terminal width
      expect(result.header.length).toBeLessThanOrEqual(terminalWidth)
      expect(result.separator.length).toBeLessThanOrEqual(terminalWidth)
      for (const row of result.rows) {
        expect(row.length).toBeLessThanOrEqual(terminalWidth)
      }
    })

    test("truncate handles very short maxLen gracefully", () => {
      const rows = [["m", "YES", "Hello World", "1ms"]]
      // This shouldn't crash even with extreme truncation
      const result = formatTable(rows, 30)
      expect(result.rows[0]).toBeDefined()
    })
  })

  describe("error messages", () => {
    test("error message in parentheses is displayed", () => {
      const rows = [["kilo/provider/model", "NO", "(Connection refused)", "500ms"]]
      const result = formatTable(rows, 120)

      expect(result.rows[0]).toContain("(Connection refused)")
    })

    test("empty snippet cell is handled", () => {
      const rows = [["kilo/provider/model", "NO", "", "500ms"]]
      const result = formatTable(rows, 120)

      // Should not crash and row should be formatted
      expect(result.rows[0]).toContain("kilo/provider/model")
      expect(result.rows[0]).toContain("NO")
      expect(result.rows[0]).toContain("500ms")
    })
  })

  describe("sanitization", () => {
    test("strips ANSI color codes from snippet", () => {
      const rows = [["model", "YES", "\x1b[92mGreen text\x1b[0m", "100ms"]]
      const result = formatTable(rows, 120)

      expect(result.rows[0]).toContain("Green text")
      expect(result.rows[0]).not.toContain("\x1b")
    })

    test("strips null bytes and control characters", () => {
      const rows = [["model", "YES", "Hello\x00World\x01Test", "100ms"]]
      const result = formatTable(rows, 120)

      expect(result.rows[0]).toContain("HelloWorldTest")
      expect(result.rows[0]).not.toContain("\x00")
      expect(result.rows[0]).not.toContain("\x01")
    })

    test("width calculation uses sanitized content", () => {
      // ANSI codes add bytes but not visible width
      const withAnsi = "\x1b[92mHi\x1b[0m" // "Hi" with color codes = 11 bytes but 2 visible chars
      const rows = [["m", "YES", withAnsi, "1ms"]]
      const result = formatTable(rows, 120)

      // Snippet column should be sized for "Hi" (2 chars), not 11 bytes
      // Header "Snippet" is 7 chars, so minimum width is 7
      const snippetColStart = result.header.indexOf("Snippet")
      const accessColEnd = result.header.indexOf("Access") + "Access".length
      const snippetWidth = result.header.indexOf(" | Latency") - snippetColStart

      expect(snippetWidth).toBe(7) // "Snippet" header length, not inflated by ANSI codes
    })

    test("strips newlines from content", () => {
      const rows = [["model", "YES", "Line1\nLine2", "100ms"]]
      const result = formatTable(rows, 120)

      expect(result.rows[0]).toContain("Line1Line2")
      expect(result.rows[0]).not.toContain("\n")
    })
  })

  describe("edge cases", () => {
    test("empty rows array", () => {
      const result = formatTable([], 120)

      expect(result.header).toContain("Model")
      expect(result.rows).toHaveLength(0)
    })

    test("handles undefined cells gracefully", () => {
      const rows = [["model", "YES", undefined as unknown as string, "100ms"]]
      const result = formatTable(rows, 120)

      // Should not crash
      expect(result.rows[0]).toContain("model")
    })

    test("very narrow terminal still produces valid output", () => {
      const rows = [["kilo/provider/model", "YES", "Hello", "100ms"]]
      const result = formatTable(rows, 40)

      // Should produce valid output even if truncated
      expect(result.header.length).toBeGreaterThan(0)
      expect(result.rows[0].length).toBe(result.header.length)
    })

    test("terminal width of 120 (default) handles typical content", () => {
      const rows = [
        ["kilo/openai/gpt-4", "YES", "Hello! How can I help you today?", "500ms"],
        ["kilo/anthropic/claude-3-opus", "YES", "Hi there! I'm Claude, an AI assistant...", "1200ms"],
        ["kilo/google/gemini-pro", "NO", "(Rate limit exceeded)", "100ms"],
      ]
      const result = formatTable(rows, 120)

      // All rows should fit within 120 chars
      expect(result.header.length).toBeLessThanOrEqual(120)
      for (const row of result.rows) {
        expect(row.length).toBeLessThanOrEqual(120)
      }
    })
  })
})
