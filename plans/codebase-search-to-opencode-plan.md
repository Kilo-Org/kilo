# Plan: Create codebase_search as OpenCode Custom Tool

## Summary

Create a `codebase_search` custom tool for OpenCode that provides semantic code search using AI embeddings. The tool will:

- Use OpenCode's documented custom tool pattern (https://opencode.ai/docs/custom-tools)
- Follow exact pattern from existing tools (github-pr-search.ts, github-triage.ts)
- Support both managed (cloud) and local indexing
- Use OpenCode's centralized Config and Auth modules
- Be installed as a custom tool in `.opencode/tool/` directory

## Analysis of Existing Tool Patterns

### Tool Structure Pattern (from github-pr-search.ts and github-triage.ts)

```typescript
/// <reference path="../env.d.ts" />
import { tool } from "@kilocode/plugin"
import DESCRIPTION from "./tool-name.txt"

// Optional helper functions
async function helperFunction() {
  // implementation
}

export default tool({
  description: DESCRIPTION,
  args: {
    paramName: tool.schema.string().describe("Description").default("default value"),
    optionalParam: tool.schema.number().describe("Description").default(0),
    enumParam: tool.schema.enum(["option1", "option2"]).describe("Description").default("option1"),
    arrayParam: tool.schema
      .array(tool.schema.enum(["a", "b"]))
      .describe("Description")
      .default([]),
  },
  async execute(args) {
    // Implementation
    return "formatted result string"
  },
})
```

### Key Pattern Elements:

1. **Import pattern**: `import { tool } from "@kilocode/plugin"`
2. **Description import**: `import DESCRIPTION from "./tool-name.txt"`
3. **Schema methods**:
   - `tool.schema.string()` - for string parameters
   - `tool.schema.number()` - for numeric parameters
   - `tool.schema.enum([...])` - for enum parameters
   - `tool.schema.array(...)` - for array parameters
4. **Schema methods**: `.describe()` and `.default()`
5. **Return value**: Formatted string (not JSON)

### Description File Pattern (from github-pr-search.txt and github-triage.txt)

- Clear usage instructions
- Examples of how to use the tool
- Detailed parameter descriptions
- Context about what the tool does

## Analysis of codebase_search from Kilocode VSCode Extension

### Key Features

- **Semantic Understanding**: Finds code by meaning rather than exact keyword matches
- **Cross-Project Search**: Searches across your entire indexed codebase, not just open files
- **Contextual Results**: Returns code snippets with file paths and line numbers for easy navigation
- **Similarity Scoring**: Results ranked by relevance with similarity scores (0-1 scale)
- **Scope Filtering**: Optional path parameter to limit searches to specific directories
- **Intelligent Ranking**: Results sorted by semantic relevance to your query
- **UI Integration**: Results displayed with syntax highlighting and navigation links
- **Performance Optimized**: Fast vector-based search with configurable result limits

### When is it used?

- When Kilo Code needs to find code related to specific functionality across your project
- When looking for implementation patterns or similar code structures
- When searching for error handling, authentication, or other conceptual code patterns
- When exploring unfamiliar codebases to understand how features are implemented
- When finding related code that might be affected by changes or refactoring

### Tool Behavior (from CodebaseSearchTool.ts)

The codebase_search tool in kilocode has the following characteristics:

1. **Two search modes**:
   - **Managed indexing** (Kilo Gateway API) - tried first
   - **Local indexing** (CodeIndexManager) - fallback

2. **Parameters**:
   - `query` (required): The search query
   - `path` (optional): Directory to limit search scope

3. **Return format**:

```
Query: {query}
Results:

File path: {relativePath}
Score: {score}
Lines: {startLine}-{endLine}
Code Chunk: {codeChunk}
```

4. **Error handling**:
   - Workspace path not found
   - Query missing
   - Indexing not ready (Indexing, Standby, Error states)
   - Indexing not configured
   - No results found

5. **Status messages** (when indexing not ready):
   - "Code indexing is still running"
   - "Code indexing has not started"
   - "Code indexing is in an error state"
   - "Code indexing is not ready"

### Requirements

This tool is only available when the Codebase Indexing feature is properly configured:

- **Feature Configured**: Codebase Indexing must be configured in settings
- **Embedding Provider**: OpenAI API key, Mistral, or Ollama configuration required
- **Vector Database**: Qdrant instance running and accessible
- **Index Status**: Codebase must be indexed (status: "Indexed" or "Indexing")

**Supported Embedding Models**:
- `codestral-embed-2505` (Mistral) - default, code-optimized
- `text-embedding-3-small` (OpenAI)
- Other models via Ollama

### Limitations

- **Requires Configuration**: Depends on external services (embedding provider + Qdrant)
- **Index Dependency**: Only searches through indexed code blocks
- **Result Limits**: Maximum of 50 results per search to maintain performance
- **Similarity Threshold**: Only returns results above similarity threshold (default: 0.4, configurable)
- **File Size Limits**: Limited to files under 1MB that were successfully indexed
- **Language Support**: Effectiveness depends on Tree-sitter language support

### How It Works

When the codebase_search tool is invoked, it follows this process:

1. **Availability Validation**:
   - Verifies that the CodeIndexManager is available and initialized
   - Confirms codebase indexing is enabled in settings
   - Checks that indexing is properly configured (API keys, Qdrant URL)
   - Validates the current index state allows searching

2. **Query Processing**:
   - Takes your natural language query and generates an embedding vector
   - Uses the same embedding provider configured for indexing (OpenAI or Ollama)
   - Converts the semantic meaning of your query into a mathematical representation

3. **Vector Search Execution**:
   - Searches the Qdrant vector database for similar code embeddings
   - Uses cosine similarity to find the most relevant code blocks
   - Applies the minimum similarity threshold (default: 0.4, configurable) to filter results
   - Limits results to 50 matches for optimal performance

4. **Path Filtering** (if specified):
   - Filters results to only include files within the specified directory path
   - Uses normalized path comparison for accurate filtering
   - Maintains relevance ranking within the filtered scope

5. **Result Processing and Formatting**:
   - Converts absolute file paths to workspace-relative paths
   - Structures results with file paths, line ranges, similarity scores, and code content
   - Formats for both AI consumption and UI display with syntax highlighting

6. **Dual Output Format**:
   - AI Output: Structured text format with query, file paths, scores, and code chunks
   - UI Output: JSON format with syntax highlighting and navigation capabilities

### Search Query Best Practices

**Effective Query Patterns**:

**Good: Conceptual and specific**
```
query: "user authentication and password validation"
```

**Good: Feature-focused**
```
query: "database connection pool setup"
```

**Good: Problem-oriented**
```
query: "error handling for API requests"
```

**Less effective: Too generic**
```
query: "function"
```

### Query Types That Work Well

- **Functional Descriptions**: "file upload processing", "email validation logic"
- **Technical Patterns**: "singleton pattern implementation", "factory method usage"
- **Domain Concepts**: "user profile management", "payment processing workflow"
- **Architecture Components**: "middleware configuration", "database migration scripts"

### Result Interpretation

**Similarity Scores**:
- **0.8-1.0**: Highly relevant matches, likely exactly what you're looking for
- **0.6-0.8**: Good matches with strong conceptual similarity
- **0.4-0.6**: Potentially relevant but may require review
- **Below 0.4**: Filtered out as too dissimilar

**Result Structure**:
Each search result includes:
- **File Path**: Workspace-relative path to the file containing the match
- **Score**: Similarity score indicating relevance (0.4-1.0)
- **Line Range**: Start and end line numbers for the code block
- **Code Chunk**: The actual code content that matched your query

### Examples When Used

- When implementing a new feature, Kilo Code searches for "authentication middleware" to understand existing patterns before writing new code.
- When debugging an issue, Kilo Code searches for "error handling in API calls" to find related error patterns across the codebase.
- When refactoring code, Kilo Code searches for "database transaction patterns" to ensure consistency across all database operations.
- When onboarding to a new codebase, Kilo Code searches for "configuration loading" to understand how the application bootstraps.

### Tool Description (from kilocode prompts)

```
Find files most relevant to search query using semantic search. Searches based on meaning rather than exact text matches. By default searches entire workspace. Reuse the user's exact wording unless there's a clear reason not to - their phrasing often helps semantic search. Queries MUST be in English (translate if needed).

**CRITICAL: For ANY exploration of code you haven't examined yet in this conversation, you MUST use this tool FIRST before any other search or file exploration tools.** This applies throughout the entire conversation, not just at the beginning. This tool uses semantic search to find relevant code based on meaning rather than just keywords, making it far more effective than regex-based search_files for understanding implementations. Even if you've already explored some code, any new area of exploration requires codebase_search first.

Parameters:
- query: (required) The search query. Reuse the user's exact wording/question format unless there's a clear reason not to.
- path: (optional) Limit search to specific subdirectory (relative to current workspace directory). Leave empty for entire workspace.
```

### Configuration System

OpenCode provides two modules for custom tools:

1. **Config Module** ([`packages/opencode/src/config/config.ts`](packages/opencode/src/config/config.ts:1273-1295))
   - Stores non-sensitive settings in `opencode.json`
   - `codebaseSearch` object with:
      - `projectId` - Project ID for codebase search
      - `embedModel` - Embedding model (default: "codestral-embed-2505")
      - `vectorDb` - Vector database configuration (Qdrant or LanceDB)
      - `similarityThreshold` - Minimum similarity score for results (default: 0.4)
      - `maxResults` - Maximum number of results to return (default: 50)

2. **Auth Module** ([`packages/opencode/src/auth/index.ts`](packages/opencode/src/auth/index.ts:38))
   - Stores sensitive credentials in `~/.local/share/kilo/auth.json`
   - API keys for providers (kilo, openai, qdrant, etc.)
   - OAuth tokens

### Kilo Gateway Integration

From [`packages/kilo-gateway/`](packages/kilo-gateway/):

- Provides `searchCode()` function for managed indexing
- Exposes authentication through OpenCode's Auth module
- Managed indexing API available via `@kilocode/kilo-gateway`

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│           OpenCode Custom Tool: codebase_search      │
├─────────────────────────────────────────────────────────┤
│ Parameters: query (string), path? (string)         │
│ Location: .opencode/tool/codebase_search.ts          │
│ Description: .opencode/tool/codebase_search.txt      │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
         ┌──────────────────────────────┐
         │  Load Configuration      │
         │  (Config.get())          │
         │  Load Auth (Auth.get())  │
         └──────────────────────────────┘
                           │
                           ▼
         ┌──────────────────────────────┐
         │  Try Managed Indexing    │
         │  (via Kilo Gateway API)     │
         └──────────────────────────────┘
                    │
                    │ Success?
                    │ No      │ Yes
                    │         │
                    ▼         │
         ┌──────────────────────┐
         │   Local Indexing     │
         │  (embeddings +      │
         │   vector store)       │
         └──────────────────────┘
                    │
                    ▼
         ┌──────────────────────┐
         │  Format & Return    │
         │    Results          │
         └──────────────────────┘
```

## Implementation Steps

### Step 1: Create Description File

**Location**: `.opencode/tool/codebase_search.txt`

```
Use this tool to find files most relevant to a search query using semantic search.

This tool searches the codebase based on meaning rather than exact text matches, making it far more effective than regex-based search for understanding implementations. By default, it searches the entire workspace.

**CRITICAL: For ANY exploration of code you haven't examined yet in this conversation, you MUST use this tool FIRST before any other search or file exploration tools.** This applies throughout the entire conversation, not just at the beginning. Even if you've already explored some code, any new area of exploration requires codebase_search first.

## Parameters

- **query** (required): The search query in natural language. Reuse the user's exact wording/question format unless there's a clear reason not to. Queries MUST be in English (translate if needed).

- **path** (optional): Limit search to a specific subdirectory (relative to the current workspace directory). Leave empty or omit to search the entire workspace.

## Usage Notes

- This tool supports both cloud-based (managed) and local indexing
- Managed indexing is tried first, with automatic fallback to local indexing
- Managed indexing requires Kilo Gateway authentication
- Local indexing requires the codebase to be indexed first
- Results include file path, relevance score, line numbers, and code snippets
- If indexing is not ready, the tool will return status information

### Directory Scoping

Use the optional path parameter to focus searches on specific parts of your codebase:

Search within API modules:
```
query: "endpoint validation middleware"
path: "src/api"
```

Search in test files:
```
query: "mock data setup patterns"
path: "tests"
```

Search specific feature directories:
```
query: "component state management"
path: "src/components/auth"
```

## Usage Examples

### Searching for authentication code in a specific directory
```
<codebase_search>
<query>user login and authentication logic</query>
<path>src/auth</path>
</codebase_search>
```

### Searching for entire workspace
```
<codebase_search>
<query>environment variables and application configuration</query>
</codebase_search>
```

### Searching for database-related code in a specific directory
```
<codebase_search>
<query>database connection and query execution</query>
<path>src/data</path>
</codebase_search>
```

### Looking for error handling patterns in API code
```
<codebase_search>
<query>HTTP error responses and exception handling</query>
<path>src/api</path>
</codebase_search>
```

### Searching for testing utilities and mock setups
```
<codebase_search>
<query>test setup and mock data creation</query>
<path>tests</path>
</codebase_search>
```

### Searching for React hooks
```
<codebase_search>
<query>useState hook implementation</query>
<path>src/components</path>
</codebase_search>
```

### Step 2: Create Tool File

**Location**: `.opencode/tool/codebase_search.ts`

```typescript
/// <reference path="../env.d.ts" />
import { tool } from "@kilocode/plugin"
import { searchCode } from "@kilocode/kilo-gateway"
import DESCRIPTION from "./codebase_search.txt"

// Helper function to get current git branch
async function getCurrentGitBranch(workspacePath: string): Promise<string> {
  try {
    const { spawn } = await import("child_process")
    return new Promise((resolve, reject) => {
      const proc = spawn("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: workspacePath })
      let output = ""
      proc.stdout?.on("data", (data) => { output += data.toString() })
      proc.on("close", (code) => {
        if (code === 0) resolve(output.trim())
        else reject(new Error(`Git command failed with code ${code}`))
      })
    })
  } catch (error) {
    return "main" // Default fallback
  }
}

// Helper function to format search results
function formatResults(query: string, results: any[], source: "managed" | "local"): string {
  if (!results || results.length === 0) {
    return `No relevant code snippets found for query: "${query}"`
  }

  const output = `Query: ${query}\nResults:\n\n`

  for (const result of results) {
    output += `File path: ${result.filePath}\n`
    output += `Score: ${result.score.toFixed(3)}\n`
    output += `Lines: ${result.startLine}-${result.endLine}\n`
    if (result.codeChunk) {
      output += `Code Chunk:\n${result.codeChunk.trim()}\n`
    }
    output += "\n"
  }

  return output
}

// Helper function to search local index (placeholder)
async function searchLocalIndex(
  workspacePath: string,
  codebaseSearch: any,
  query: string,
  directoryPath?: string,
): Promise<any[]> {
  // TODO: Implement local indexing
  // This would use:
  // - codebaseSearch.embedModel (e.g., "codestral-embed-2505")
  // - codebaseSearch.vectorDb (Qdrant or LanceDB)
  // - Auth.get("openai") or Auth.get("qdrant") for API keys

  throw new Error("Local indexing not yet implemented. Please use managed indexing.")
}

export default tool({
  description: DESCRIPTION,
  args: {
    query: tool.schema.string().describe("The search query in natural language (required)"),
    path: tool.schema.string().describe("Optional directory path to filter results (relative to workspace)").default(""),
  },
  async execute(args) {
    // 1. Load configuration from Config module
    const config = await this.config.get()
    const codebaseSearch = config.codebaseSearch ?? {}

    // 2. Load authentication from Auth module
    const kiloAuth = await this.auth.get("kilo")

    // 3. Get workspace path
    const workspacePath = this.directory
    if (!workspacePath) {
      throw new Error("No workspace directory found")
    }

    // 4. Try managed (cloud) indexing first if kiloAuth is available
    if (kiloAuth) {
      try {
        const kiloToken = kiloAuth.type === "oauth" ? kiloAuth.access : kiloAuth.key
        const organizationId = kiloAuth.type === "oauth" ? (kiloAuth.accountId ?? null) : null

        if (kiloToken && codebaseSearch.projectId && organizationId) {
          const results = await searchCode(
            {
              query: args.query,
              organizationId,
              projectId: codebaseSearch.projectId,
              preferBranch: await getCurrentGitBranch(workspacePath),
              fallbackBranch: "main",
              excludeFiles: [],
              path: args.path || undefined,
            },
            kiloToken,
            this.abort,
          )

          return formatResults(args.query, results, "managed")
        }
      } catch (error) {
        // Fall through to local indexing
        console.debug("Managed search failed, trying local:", error instanceof Error ? error.message : String(error))
      }
    }

    // 5. Fall back to local indexing
    if (codebaseSearch?.vectorDb) {
      try {
        const results = await searchLocalIndex(
          workspacePath,
          codebaseSearch,
          args.query,
          args.path || undefined,
        )
        return formatResults(args.query, results, "local")
      } catch (error) {
        throw new Error(`Local indexing search failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // 6. No indexing configured
    throw new Error(
      "Codebase search is not configured. Please configure in opencode.json:\n" +
        JSON.stringify({
          codebaseSearch: {
            projectId: "your-project-id",
            embedModel: "codestral-embed-2505",
            vectorDb: {
              type: "qdrant",
              url: "http://localhost:6333"
            },
            similarityThreshold: 0.4,
            maxResults: 50
          }
        }, null, 2)
    )
  },
}
```

### Step 3: Configuration Examples

**Example `opencode.json`**:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "codebaseSearch": {
    "projectId": "your-project-id",
    "embedModel": "codestral-embed-2505",
    "vectorDb": {
      "type": "qdrant",
      "url": "http://localhost:6333"
    },
    "similarityThreshold": 0.4,
    "maxResults": 50
  }
}
```

**Example with LanceDB**:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "codebaseSearch": {
    "projectId": "your-project-id",
    "embedModel": "codestral-embed-2505",
    "vectorDb": {
      "type": "lancedb",
      "path": ".opencode/index"
    },
    "similarityThreshold": 0.4,
    "maxResults": 50
  }
}
```

### Step 4: Authentication Setup

**For managed indexing (Kilo Gateway)**:

```bash
opencode auth set kilo
# Or via OAuth
opencode auth login
```

**For local indexing with OpenAI embeddings**:

```bash
opencode auth set openai
```

**For local indexing with Mistral embeddings**:

```bash
opencode auth set mistral
```

**For local indexing with Ollama**:

```bash
# Configure Ollama in opencode.json with base URL (default: http://localhost:11434)
```

**For Qdrant vector database**:

```bash
opencode auth set qdrant
```

### Step 5: Local Indexing Implementation (Future)

To implement local indexing, you'll need to:

1. **Create embeddings** using configured model:
   - `codestral-embed-2505` (Mistral)
   - `text-embedding-3-small` (OpenAI)
   - Other models via Ollama

2. **Store vectors** in configured database:
   - Qdrant: Requires URL and API key from Auth module
   - LanceDB: Requires path from config

3. **Perform similarity search**:
   - Query embedding
   - Vector similarity search (using cosine similarity)
   - Apply minimum similarity threshold (default: 0.4, configurable)
   - Limit results to maxResults (default: 50)
   - Return top N results with scores

This can be implemented as a separate module or integrated directly into the tool.

## File Structure

```
.opencode/
  tool/
    codebase_search.ts  ← Custom tool file (this is what we create)
    codebase_search.txt  ← Description file (this is what we create)
```

**Configuration file**: `opencode.json` (in project root or global config)

**Authentication**: `~/.local/share/kilo/auth.json` (managed by OpenCode)

## Benefits of Custom Tool Approach

1. **No core modifications** - Tool can be developed independently
2. **Easy distribution** - Can be shared as a standalone file
3. **Future-proof** - Won't conflict with upstream opencode merges
4. **Follows conventions** - Matches documented custom tool pattern
5. **Uses existing infrastructure** - Leverages Config and Auth modules
6. **Proper separation** - Credentials in Auth, settings in Config

## Configuration vs Credentials

| Type                                      | Storage                         | Example                    | Access Method |
| ----------------------------------------- | ------------------------------- | -------------------------- | ------------- |
| **Credentials** (API keys, tokens)        | `~/.local/share/kilo/auth.json` | `ctx.auth.get("provider")` |
| **Configuration** (settings, preferences) | `opencode.json`                 | `ctx.config.get()`         |

This separation follows security best practices:

- **Credentials** → Auth module (sensitive, user-specific)
- **Configuration** → Config module (non-sensitive, project-specific)

## Testing Strategy

### Manual Testing Checklist

- [ ] Tool loads from `.opencode/tool/` directory
- [ ] Tool description loads from `.txt` file
- [ ] Tool appears in available tools list
- [ ] Tool can be called from OpenCode CLI
- [ ] Tool can be called from OpenCode TUI
- [ ] Tool can be called from OpenCode Web
- [ ] Returns results for managed indexing
- [ ] Falls back to local indexing when configured
- [ ] Clear error messages for:
  - [ ] No auth token
  - [ ] No project ID
  - [ ] Local indexing not configured
  - [ ] Network errors
- [ ] Works with different query types:
  - [ ] Single concept ("authentication")
  - [ ] Multi-term ("user login password hashing")
  - [ ] Domain-specific ("React useState hook")
- [ ] Respects directory filter
- [ ] Handles git branch detection correctly
- [ ] Returns properly formatted results matching kilocode format

## Success Criteria

- ✅ Tool file created at `.opencode/tool/codebase_search.ts`
- ✅ Description file created at `.opencode/tool/codebase_search.txt`
- ✅ Tool uses OpenCode's Config module for settings
- ✅ Tool uses OpenCode's Auth module for credentials
- ✅ Managed indexing works with Kilo Gateway
- ✅ Configuration stored in `opencode.json`
- ✅ Credentials stored in Auth module
- ✅ No modifications to core OpenCode code
- ✅ Follows custom tool documentation pattern
- ✅ Follows existing tool pattern (github-pr-search.ts, github-triage.ts)
- ✅ Works across all OpenCode interfaces (CLI, TUI, Web)
- ✅ Return format matches kilocode tool format

## Open Questions

1. **Local Indexing**: Should we implement local indexing now, or start with managed indexing only?
2. **Embedder Support**: Should we support multiple embedder types (OpenAI, Mistral, Ollama) from the start?
3. **Index Initialization**: Should the tool auto-initialize local index, or require a separate indexing command?

## References

### Kilo Documentation

- codebase_search Tool: https://kilo.ai/docs/automate/tools/codebase_search

### OpenCode Documentation

- Custom Tools: https://opencode.ai/docs/custom-tools/
- Tool Pattern: `packages/opencode/src/tool/`
- Plugin Types: `packages/plugin/src/`

### Kilo Gateway

- `packages/kilo-gateway/src/index.ts`
- `packages/kilo-gateway/src/services/code-indexing/managed/api-client.ts`

### Existing Implementation

- Kilocode tool: `../kilocode/src/core/tools/CodebaseSearchTool.ts`
- Kilocode description: `../kilocode/src/core/prompts/tools/native-tools/codebase_search.ts`
- Config: `packages/opencode/src/config/config.ts` (already has codebaseSearch schema)
- Auth: `packages/opencode/src/auth/index.ts` (already supports all providers)

### Existing Tool Patterns

- `github-pr-search.ts` - GitHub PR search tool
- `github-triage.ts` - GitHub issue triage tool
- `packages/plugin/src/example.ts` - Example custom tool
