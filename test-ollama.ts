#!/usr/bin/env bun
/**
 * Simple test script to verify Ollama provider is working
 * Run this manually to test the implementation
 */

import { Provider } from "./packages/opencode/src/provider/provider"
import { Instance } from "./packages/opencode/src/project/instance"

async function testOllama() {
  console.log("Testing Ollama Provider...\n")

  await Instance.provide({
    directory: process.cwd(),
    fn: async () => {
      try {
        // Get all providers
        const providers = await Provider.list()
        console.log("Available providers:", Object.keys(providers).join(", "))

        // Check if Ollama is available
        const ollama = providers["ollama"]

        if (ollama) {
          console.log("\n✅ Ollama provider found!")
          console.log("  ID:", ollama.id)
          console.log("  Name:", ollama.name)
          console.log("  Environment variables:", ollama.env?.join(", "))
          console.log("  Source:", ollama.source)
          console.log("  Number of models:", Object.keys(ollama.models || {}).length)

          if (Object.keys(ollama.models).length > 0) {
            console.log("\n  Available models:")
            for (const [id, model] of Object.entries(ollama.models)) {
              console.log(`    - ${id}: ${model.name}`)
            }
          } else {
            console.log("\n  ⚠️  No models loaded yet (this is normal, models load dynamically)")
          }
        } else {
          console.log("\n❌ Ollama provider NOT found!")
          console.log("   Make sure the provider is properly registered.")
        }

        // Test model fetching if we can get a model
        if (ollama && Object.keys(ollama.models).length > 0) {
          const firstModelId = Object.keys(ollama.models)[0]
          console.log(`\n📝 Testing model loading: ${firstModelId}`)
          try {
            const model = await Provider.getModel("ollama", firstModelId)
            console.log("  ✅ Model loaded successfully!")
            console.log("  Model ID:", model.id)
            console.log("  Provider ID:", model.providerID)
          } catch (e) {
            console.log("  ⚠️  Could not load model:", e.message)
          }
        }

      } catch (error) {
        console.error("\n❌ Error testing Ollama provider:", error)
      }
    },
  })
}

testOllama()
