#!/bin/bash
# Quick test script for Ollama in dev mode

echo "🚀 Testing Ollama Provider in Dev Mode"
echo ""

# Option 1: With environment variables
echo "Option 1: Using environment variables"
echo "  OLLAMA_HOST=http://127.0.0.1:11434 \"
echo "  OLLAMA_API_KEY=sk-EJuYJSYVtHy5ToEir0gl0JtSsQa4epbj \"
echo "  bun dev"
echo ""

# Option 2: After running kilo auth login
echo "Option 2: After interactive setup"
echo "  bun dev"
echo ""

# Option 3: Test specific model
echo "Option 3: Test with specific model"
echo "  OLLAMA_HOST=http://127.0.0.1:11434 \"
echo "  OLLAMA_API_KEY=sk-EJuYJSYVtHy5ToEir0gl0JtSsQa4epbj \"
echo "  bun dev --model ollama/llama3.2"
echo ""

echo "In Kilo CLI:"
echo "  1. Press Ctrl+P to open provider switcher"
echo "  2. Select Ollama"
echo "  3. Choose your model"
echo "  4. Type your prompt and press Enter"
