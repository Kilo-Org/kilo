# Ollama Provider

This document describes the Ollama provider integration for Kilo CLI, which allows you to use locally running AI models via Ollama.

## Overview

[Ollama](https://ollama.com) is a popular tool for running large language models locally on your machine. This provider integrates Ollama with Kilo CLI, enabling:

- **Privacy**: All processing happens locally on your machine
- **Cost**: Free inference with no API costs
- **Offline Development**: Work without an internet connection
- **Custom Models**: Use any model available through Ollama

## Prerequisites

1. Install Ollama from [ollama.com](https://ollama.com)
2. Pull at least one model:
   ```bash
   ollama pull llama3.2
   ```
3. Ensure Ollama is running (it starts automatically after installation)

## Configuration

### Basic Usage

By default, Kilo CLI will auto-detect Ollama running on `http://localhost:11434`. Simply select the Ollama provider and choose a model.

### Custom Configuration

Add to your `~/.opencode/config.json`:

```json
{
  "provider": {
    "ollama": {
      "options": {
        "baseURL": "http://localhost:11434"
      }
    }
  }
}
```

### Environment Variables

- `OLLAMA_HOST`: Set the Ollama host URL (alternative to config)

## Supported Models

The provider will automatically detect all models installed in your Ollama instance. Common models include:

- **Llama 3.2** (`llama3.2`) - Meta's latest Llama model
- **Llama 3.1** (`llama3.1`) - Previous Llama version
- **Mistral** (`mistral`) - Fast and capable
- **Code Llama** (`codellama`) - Optimized for code
- **And many more...**

To see all available models:
```bash
ollama list
```

To pull a new model:
```bash
ollama pull <model-name>
```

## Usage

### Interactive Mode

```bash
# Start Kilo CLI with Ollama
kilo

# Then use Ctrl+P to switch to Ollama provider
# and select your preferred model
```

### Configuration File

Set Ollama as your default provider:

```json
{
  "model": "ollama/llama3.2",
  "provider": {
    "ollama": {
      "options": {
        "baseURL": "http://localhost:11434"
      }
    }
  }
}
```

### Command Line

```bash
# Run with a specific Ollama model
kilo run --provider ollama --model llama3.2 "your prompt here"
```

## Custom Model Configuration

You can add custom models or override existing ones in your config:

```json
{
  "provider": {
    "ollama": {
      "models": {
        "my-custom-model": {
          "id": "my-custom-model",
          "name": "My Custom Model",
          "limit": {
            "context": 128000,
            "output": 4096
          }
        }
      }
    }
  }
}
```

## Troubleshooting

### "No models found"

Ensure Ollama is running:
```bash
ollama serve
```

Or check if Ollama is installed correctly:
```bash
ollama --version
```

### Connection refused

Verify Ollama is listening on the expected port:
```bash
curl http://localhost:11434/api/tags
```

If Ollama is running on a different host or port, update your configuration:
```json
{
  "provider": {
    "ollama": {
      "options": {
        "baseURL": "http://your-ollama-host:11434"
      }
    }
  }
}
```

### Slow responses

Local models require significant compute resources. For better performance:
- Use smaller models (e.g., `llama3.2` instead of `llama3.1:70b`)
- Ensure your machine has sufficient RAM
- Use a machine with a GPU for faster inference

## Limitations

- **No tool calling**: Most Ollama models don't support function calling
- **No vision**: Text-only models (no image input)
- **Context limits**: Varies by model (typically 4K-128K tokens)
- **Performance**: Depends on your local hardware

## Remote Ollama Instances

You can connect to remote Ollama instances:

```json
{
  "provider": {
    "ollama": {
      "options": {
        "baseURL": "http://remote-server:11434"
      }
    }
  }
}
```

Note: Ensure the remote Ollama instance is accessible and properly configured.

## Contributing

To contribute to the Ollama provider:

1. Test with various Ollama models
2. Report issues with specific models
3. Improve model detection and metadata
4. Add support for new Ollama features

See [CONTRIBUTING.md](../../CONTRIBUTING.md) for guidelines.

## Resources

- [Ollama Documentation](https://github.com/ollama/ollama/tree/main/docs)
- [Ollama Models Library](https://ollama.com/library)
- [Kilo CLI Documentation](https://kilo.ai/docs)
