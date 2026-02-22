---
sidebar_label: ZenMux
---

# Using ZenMux With Kilo Code

ZenMux is an AI gateway that lets you route requests to multiple model providers from one account and API key.

**Website:** [https://zenmux.ai/](https://zenmux.ai/)

## Getting an API Key

1. **Sign up or sign in:** Go to [zenmux.ai](https://zenmux.ai/).
2. **Create an API key:** Open your ZenMux dashboard and generate a key.
3. **Copy the key:** Save it somewhere secure.

## Configuration in Kilo Code

1. **Open Kilo Code Settings:** Click the gear icon ({% codicon name="gear" /%}) in the Kilo Code panel.
2. **Select Provider:** Choose "ZenMux" from the API provider dropdown.
3. **Enter API Key:** Paste your ZenMux API key into the ZenMux API key field.
4. **Select Model:** Pick a model from the model dropdown.
5. **(Optional) Set custom base URL:** Only needed for custom ZenMux routing setups.

## Tips and Notes

- **Model catalog:** ZenMux exposes models from multiple providers. Check [zenmux.ai/models](https://zenmux.ai/models) for availability.
- **Routing behavior:** Model availability, latency, and policy settings can affect which backend handles a request.
- **Fallbacks:** Some setups may fail over to another provider automatically when a backend is unavailable.
- **Troubleshooting:** If requests fail, verify your key, account credits, and base URL settings first.

## Relevant Resources

- [ZenMux Documentation](https://zenmux.ai/docs)
- [ZenMux Models](https://zenmux.ai/models)
