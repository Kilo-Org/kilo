# Speech-to-text (voice input)

- **What it is**: A streaming STT subsystem for dictation/voice input.

## Status

🔨 Partial

## Current progress

- Added a webview-side voice input control in chat prompt input (`PromptInput`).
- Uses browser `SpeechRecognition`/`webkitSpeechRecognition` when available.
- Supports start/stop capture, live transcript insertion into textarea, and graceful unsupported/error handling.
- Recording is stopped automatically when the prompt is sent or when the session becomes unavailable/busy.

## Suggested migration

- **Kilo CLI availability**: Already.
- **Migration recommendation**:
  - Keep speech capture and UX in the webview/UI (microphone permissions and streaming).
  - Use Kilo CLI-compatible STT flows where helpful, but avoid making STT a required server capability.
- **Reimplementation required?**: Partial.

## Primary implementation anchors

- [`webview-ui/src/components/chat/PromptInput.tsx`](../../webview-ui/src/components/chat/PromptInput.tsx)

## Remaining gaps

- No provider-agnostic backend STT service integration yet.
- No advanced transcription controls (language override, punctuation mode, push-to-talk hotkey).
