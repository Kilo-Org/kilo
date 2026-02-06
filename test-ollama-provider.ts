#!/usr/bin/env bun
/**
 * Test Ollama provider appears in Kilo
 */

import { Provider } from "./packages/opencode/src/provider/provider"
import { Instance } from "./packages/opencode/src/project/instance"

async function testOllamaInKilo() {
  console.log("🔍 Testing Ollama Provider in Kilo CLI\n")
  
  await Instance.provide({
    directory: process.cwd(),
    fn: async () => {
      const providers = await Provider.list()
      const providerNames = Object.keys(providers)
      
      console.log(`Found ${providerNames.length} providers:`)
      providerNames.forEach(name => {
        const p = providers[name]
        const modelCount = Object.keys(p.models || {}).length
        console.log(`  ${name}: ${p.name} (${modelCount} models)`)
      })
      
      console.log()
      
      if (providers["ollama"]) {
        console.log("✅ Ollama provider is available!")
        const ollama = providers["ollama"]
        console.log(`   API: ${ollama.api}`)
        console.log(`   Models: ${Object.keys(ollama.models).join(", ")}`)
      } else {
        console.log("❌ Ollama provider NOT found")
        console.log("   Make sure OLLAMA_HOST and OLLAMA_API_KEY are set")
      }
    },
  })
}

testOllamaInKilo()
