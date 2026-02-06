#!/usr/bin/env bun
/**
 * Debug script to test Ollama connectivity
 * Run this to see why Ollama provider isn't appearing
 */

async function testOllama() {
  console.log("🔍 Testing Ollama Connection\n")
  
  // Check environment variables
  const baseURL = process.env.OLLAMA_HOST || "http://localhost:11434"
  const apiKey = process.env.OLLAMA_API_KEY
  
  console.log("Configuration:")
  console.log(`  Base URL: ${baseURL}`)
  console.log(`  API Key: ${apiKey ? "✓ Set" : "✗ Not set"}`)
  console.log()
  
  // Test 1: Native endpoint
  console.log("Test 1: Checking /api/tags endpoint...")
  try {
    const fetchOptions: RequestInit = {
      signal: AbortSignal.timeout(5000),
    }
    
    if (apiKey) {
      fetchOptions.headers = {
        "Authorization": `Bearer ${apiKey}`,
      }
    }
    
    const response = await fetch(`${baseURL}/api/tags`, fetchOptions)
    console.log(`  Status: ${response.status} ${response.statusText}`)
    
    if (response.ok) {
      const data = await response.json()
      console.log(`  ✓ SUCCESS! Found ${data.models?.length || 0} models`)
      if (data.models?.length > 0) {
        console.log("  Models:")
        data.models.forEach((m: any) => console.log(`    - ${m.name}`))
      }
    } else {
      console.log(`  ✗ Failed: ${await response.text()}`)
    }
  } catch (error) {
    console.log(`  ✗ Error: ${error.message}`)
  }
  
  console.log()
  
  // Test 2: OpenAI-compatible endpoint
  console.log("Test 2: Checking /v1/models endpoint...")
  try {
    const fetchOptions: RequestInit = {
      signal: AbortSignal.timeout(5000),
    }
    
    if (apiKey) {
      fetchOptions.headers = {
        "Authorization": `Bearer ${apiKey}`,
      }
    }
    
    const response = await fetch(`${baseURL}/v1/models`, fetchOptions)
    console.log(`  Status: ${response.status} ${response.statusText}`)
    
    if (response.ok) {
      const data = await response.json()
      const models = data.data || data.models || []
      console.log(`  ✓ SUCCESS! Found ${models.length} models`)
      if (models.length > 0) {
        console.log("  Models:")
        models.forEach((m: any) => console.log(`    - ${m.id || m.name}`))
      }
    } else {
      console.log(`  ✗ Failed: ${await response.text()}`)
    }
  } catch (error) {
    console.log(`  ✗ Error: ${error.message}`)
  }
  
  console.log()
  console.log("📋 Troubleshooting Tips:")
  console.log("  1. Ensure Ollama is running: ollama serve")
  console.log("  2. Check if Ollama is accessible at the base URL")
  console.log("  3. If using SSH tunnel, ensure it's active")
  console.log("  4. If API key is required, set OLLAMA_API_KEY")
  console.log()
  console.log("📖 To set environment variables:")
  console.log(`  export OLLAMA_HOST="${baseURL}"`)
  if (apiKey) {
    console.log(`  export OLLAMA_API_KEY="${apiKey}"`)
  }
}

testOllama()
