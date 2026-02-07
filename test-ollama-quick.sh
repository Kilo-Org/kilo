#!/bin/bash
# Test Ollama configuration

echo "🔧 Testing Ollama Setup"
echo ""

# Create config file directly
echo "Creating config file..."
mkdir -p ~/.opencode

cat > ~/.opencode/config.json << 'CONFIGEOF'
{
  "provider": {
    "ollama": {
      "options": {
        "baseURL": "http://127.0.0.1:11434",
        "apiKey": "sk-EJuYJSYVtHy5ToEir0gl0JtSsQa4epbj"
      }
    }
  }
}
CONFIGEOF

echo "✅ Config created at ~/.opencode/config.json"
echo ""
echo "Now run: bun dev"
