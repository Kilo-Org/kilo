#!/usr/bin/env bun
/**
 * Debug config loading
 */

import { Config } from "./packages/opencode/src/config/config"
import { Instance } from "./packages/opencode/src/project/instance"

async function testConfig() {
  await Instance.provide({
    directory: process.cwd(),
    fn: async () => {
      const config = await Config.get()
      console.log("Config loaded:")
      console.log(JSON.stringify(config.provider, null, 2))
      
      const ollamaConfig = config.provider?.["ollama"]
      console.log("\nOllama config:", ollamaConfig)
      
      const baseURL = ollamaConfig?.options?.baseURL
      const apiKey = ollamaConfig?.options?.apiKey
      
      console.log("\nBase URL:", baseURL)
      console.log("API Key:", apiKey ? "Set" : "Not set")
    },
  })
}

testConfig()
