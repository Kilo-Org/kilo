# Ollama Provider

This document describes the Ollama provider integration for Kilo CLI, which allows you to use locally running AI models via Ollama.

## Overview

[Ollama](https://ollama.com) is a popular tool for running large language models locally on your machine. This provider integrates Ollama with Kilo CLI, enabling:

- **Privacy**: All processing happens locally on your machine
- **Cost**: Free inference with no API costs
- **Offline Development**: Work without an internet connection
- **Custom Models**: Use any model available through Ollama

## Prerequisites

1. Install Ollama from [ollama.com](https://ollama.com) (or have access to a remote Ollama instance)
2. Pull at least one model (if running locally):
   ```bash
   ollama pull llama3.2
   ```
3. Ensure Ollama is running and accessible

## How It Works

Kilo CLI automatically discovers Ollama models when the provider is loaded:

1. **For local Ollama**: Auto-detected at `http://localhost:11434`
2. **For remote Ollama**: Configure `baseURL` and optionally `apiKey`
3. **Model Discovery**: On startup, Kilo fetches available models from `/api/tags` (native) or `/v1/models` (OpenAI-compatible)
4. **Dynamic Loading**: Models only appear in the provider list after successful connection

**Note**: If Ollama doesn't appear in your provider list, it means Kilo couldn't connect. Check your configuration and ensure Ollama is accessible.

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
- `OLLAMA_API_KEY`: API key for secured/remote Ollama instances (optional)

### Interactive Setup (Recommended)

The easiest way to configure Ollama is using the interactive setup command:

```bash
kilo auth login ollama
```

This will prompt you for:
1. **Host URL** - Your Ollama server address (e.g., `http://localhost:11434` or `http://192.168.1.100:11434`)
2. **API Key** - Whether your instance requires authentication
3. **Key Value** - The API key if required

The configuration is automatically saved to both `auth.json` and `opencode.json`.

**Example for local Ollama:**
```bash
$ kilo auth login ollama
> Enter Ollama host URL: http://localhost:11434
> Does your Ollama instance require an API key? No
✓ Ollama configured with host: http://localhost:11434
```

**Example for remote/secured Ollama:**
```bash
$ kilo auth login ollama
> Enter Ollama host URL: http://my-server:11434
> Does your Ollama instance require an API key? Yes
> Enter your API key: sk-xxxxxxxx
✓ Ollama configured with host: http://my-server:11434
```

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

## Remote/Secured Ollama Instances

You can connect to remote Ollama instances or instances protected with an API key:

### Basic Remote Connection

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

### Secured with API Key

If your Ollama instance requires authentication (e.g., behind a reverse proxy or accessed via SSH tunnel):

**Option 1: Config File**
```json
{
  "provider": {
    "ollama": {
      "options": {
        "baseURL": "http://127.0.0.1:11434",
        "apiKey": "sk-your-api-key-here"
      }
    }
  }
}
```

**Option 2: Environment Variables**
```bash
export OLLAMA_HOST="http://127.0.0.1:11434"
export OLLAMA_API_KEY="sk-your-api-key-here"
kilo
```

### SSH Tunnel Example

Forward remote Ollama to local port with authentication:
```bash
# On local machine, forward remote port 11434 to local port 11434
ssh -L 11434:localhost:11434 user@remote-server

# Configure Kilo to use the tunnel with your API key
export OLLAMA_API_KEY="sk-your-api-key-here"
kilo --provider ollama --model llama3.2
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
