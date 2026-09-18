# Ramble to Slides

Talk aimlessly about your topic, let an AI agent ask follow-up questions in the pauses, and get a first draft of a Marp slide deck when you stop. Everything runs in the browser; there is no server.

https://mtsmfm.github.io/ramble-to-slides/

[![Demo video](https://i.ytimg.com/vi/cZeaBW6nhE4/hqdefault.jpg)](https://youtu.be/cZeaBW6nhE4)

- **Transcription**: whisper-large-v3-turbo (or whisper-small) on WebGPU via transformers.js, with Silero VAD. A per-project list of proper nouns biases recognition. Without WebGPU the browser's own recognizer (Web Speech API, on-device or cloud; Chrome / Edge / Safari) can be chosen instead.
- **Storage**: the File System Access API writes audio, transcript, Q&A, notes, outline and slides into a folder you choose.
- **LLM**: none is built in. The page exposes its state as WebMCP tools; any MCP client (for example Claude Code through [WebMCP Cloud Relay](https://github.com/mtsmfm/webmcp-cloud-relay)) plays the facilitator that asks questions, structures the talk and writes the slides. No API key is needed.
- UI in English and Japanese; speech recognition in English or Japanese.

## Usage

1. Open the page and choose a folder for the project.
2. Connect your agent to the page's WebMCP tools, either way (the page's tutorial walks through both):
   - **[WebMCP Cloud Relay](https://github.com/mtsmfm/webmcp-cloud-relay) extension**: install it, register its MCP URL with your agent, and press "Connect this tab". Easy, but tool calls pass through a relay server (self-hostable).
   - **[chrome-devtools-mcp](https://github.com/ChromeDevTools/chrome-devtools-mcp)** with `--categoryExperimentalWebmcp --chromeArg=--enable-features=WebMCP` (Chrome 150+): everything stays local; the agent launches its own Chrome window and you use the page there.

   The ChatGPT desktop app's built-in browser speaks WebMCP but lacks the File System Access API, so it does not work.
3. Paste the one-line prompt shown in the page's tutorial into the agent. The agent fetches the facilitation playbook through the `get_instructions` tool and takes it from there.

## Development

```sh
cd app && pnpm install && pnpm dev   # http://localhost:5173
```

- `pnpm typecheck` / `pnpm build`
- The File System Access API and the microphone require localhost or HTTPS.
- Recordings and other user data live only in the folder chosen in the browser; nothing is stored in this repository.
- Deployed to GitHub Pages by `.github/workflows/pages.yml`.

## License

MIT
