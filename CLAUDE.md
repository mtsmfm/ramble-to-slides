# Ramble to Slides

Turns a rambling talk into a first draft of a slide deck. **Fully static site** (no server):

- Transcription: in-browser WebGPU whisper-large-v3-turbo / whisper-small (transformers.js) + Silero VAD (vad-web), or the browser's Web Speech API (on-device / cloud). A proper-noun list biases recognition
- Storage: File System Access API, into a project directory the user picks
- Slides: marp-core running in the browser
- The "ask / structure / write slides" role belongs to **this Claude Code session**. The page exposes WebMCP tools; they are called through webmcp-cloud-relay

## Development

```sh
cd app && pnpm install && pnpm dev     # http://localhost:5173
```

- The File System Access API and the microphone need localhost or HTTPS. To open from another host, use `pnpm dev --host 0.0.0.0 --port <port>` and `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=<hostname>`
- `pnpm typecheck` / `pnpm build`
- pnpm's `minimumReleaseAge` rejects packages published less than 7 days ago
- GitHub Pages deploy: `.github/workflows/pages.yml`

## Files (app/src)

- `audio/recorder.ts` microphone + VAD. Constants such as `pauseAfterS` live here
- `asr/asr.worker.ts` whisper inference (Worker). Proper-noun prompt, re-inference on dropouts, hallucination filter
- `asr/default-model.ts` default model for new projects: remembered per device in localStorage, else guessed from the WebGPU adapter (none: the user must choose)
- `asr/engine.ts` `SpeechEngine` factory (whisper wraps `transcriber.ts`); `asr/webspeech.ts` Web Speech API engine, timestamps from the VAD
- `session.ts` state and the wait_for_event queue
- `store/project.ts` project directory persistence (audio.wav, transcript.jsonl, questions.jsonl, events.jsonl, outline.md, slides.md, glossary.txt, notes.md)
- `mcp/tools.ts` WebMCP tools
- `slides/marp.ts` Marp rendering
- `i18n.ts` every UI string in both languages. `index.html` carries only `data-i18n` keys; `applyI18n` fills the text

## Facilitation (done by this session)

The playbook is `app/src/mcp/instructions.md`. The page returns the same content from the `get_instructions` tool, so users of the public site only paste one sentence from the tutorial into their AI. When working in this repository, if the user says "start" (「始めて」), read `get_instructions` (or that file) and follow it. To change the procedure, edit instructions.md.
