#!/bin/bash
# Setup script for remote Ollama via SSH tunnel

echo "Setting up Ollama connection..."

# Set environment variables
export OLLAMA_HOST="http://127.0.0.1:11434"
export OLLAMA_API_KEY="sk-EJuYJSYVtHy5ToEir0gl0JtSsQa4epbj"

echo "OLLAMA_HOST=$OLLAMA_HOST"
echo "OLLAMA_API_KEY=$OLLAMA_API_KEY"

echo ""
echo "To use with Kilo CLI:"
echo "  bun dev"
echo ""
echo "Or run the debug script:"
echo "  bun debug-ollama.ts"
