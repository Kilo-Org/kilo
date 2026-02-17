// kilocode_change - new file
/**
 * Kilo Code codebase search module
 *
 * This module provides Kilo-specific configuration and utilities for
 * the codebase-search tool. It extracts Kilo-specific logic from the
 * shared tool implementation to minimize merge conflicts with upstream.
 *
 * Components:
 * - types.ts: Configuration schemas and types
 * - config.ts: Configuration loading and validation
 * - collection.ts: Collection naming (matches VSCode extension pattern)
 * - embeddings.ts: Embedding provider implementations
 */

export { CodebaseSearchTypes, CODEBASE_SEARCH_DEFAULTS } from "./types"
export { CodebaseSearchConfig } from "./config"
export { CodebaseSearchCollection } from "./collection"
export { CodebaseSearchEmbeddings } from "./embeddings"
