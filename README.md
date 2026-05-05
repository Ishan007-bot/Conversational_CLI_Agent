# Scaler Clone CLI Agent

A conversational CLI agent (in the spirit of Cursor / Windsurf) that takes a natural-language instruction in your terminal, reasons step-by-step, and produces a working local clone of the Scaler Academy website using HTML, CSS, and vanilla JavaScript.

> Status: **Phase 2 — conversational REPL complete**. Scaler-specific design brief, self-review loop, and demo polish land in subsequent phases.

## How it works

The agent runs in a strict loop:

```
START -> THINK -> TOOL -> OBSERVE -> THINK -> ... -> OUTPUT
```

Every turn the model emits one JSON object. When it asks for a tool, the runtime executes the tool locally and feeds the result back as an `OBSERVE` message. The loop continues until the model emits an `OUTPUT` step.

## Available tools

| Tool | Purpose |
| --- | --- |
| `fetchWebpage(url)` | Fetch the raw HTML of a URL (with SPA `__NEXT_DATA__` extraction). |
| `writeFile({path, content})` | Create / overwrite a file, auto-creating parent dirs. |
| `readFile({path})` | Read a file back (used for self-review). |
| `listFiles({dir})` | List directory entries. |
| `createFolder({path})` | Recursive mkdir. |
| `openInBrowser({path})` | Open a local file in the default browser (Windows / macOS / Linux). |
| `executeCommand(cmd)` | Run a shell command. |
| `getTheWeatherOfCity(city)` | Live weather demo tool. |
| `getGithubDetailsAboutUser(user)` | Public GitHub profile demo tool. |

## Setup

```bash
npm install
cp .env.example .env
```

Then open `.env` and add **one** provider's API key:

- **Groq (free, default)** — get a key at https://console.groq.com/keys, paste into `GROQ_API_KEY=`
- **OpenAI (paid, optional)** — set `LLM_PROVIDER=openai` and add `OPENAI_API_KEY=sk-...`

The agent uses the OpenAI SDK against either provider's chat-completions endpoint, so the rest of the code is provider-agnostic.

## Run

```bash
# Conversational REPL (default)
npm start
```

You'll get a `you >` prompt. Type a request and the agent reasons through it step-by-step. Multi-turn history persists across prompts, so follow-ups like *"now make the hero darker"* work after an initial build.

### Slash commands

| Command | Effect |
| --- | --- |
| `/help` | Show the command reference |
| `/clear` | Reset conversation history |
| `/history` | Print how many messages are in history |
| `/save <file>` | Write the conversation JSON to `<file>` |
| `/exit` (or `/q`) | Leave the agent |

### Other scripts

```bash
# Live API smoke test (verifies provider + tool wiring)
npm run smoke

# Offline structural self-check (no API key required)
npm run selfcheck
```

## Project layout

```
src/
  index.js           CLI entry
  smoke.js           Phase 1 smoke test
  agent.js           START/THINK/TOOL/OBSERVE/OUTPUT loop
  prompts/
    system.js        System prompt (Scaler design brief added in Phase 4)
  tools/
    fs.js            writeFile / readFile / listFiles / createFolder / openInBrowser
    shell.js         executeCommand
    web.js           fetchWebpage / weather / github
output/              Generated site lands here (gitignored)
```

## Roadmap

- **Phase 1** — Foundation, fixed tools, smoke test ✅
- **Phase 2** — Conversational REPL (readline + multi-turn history + slash commands) ✅
- **Phase 3** — File-system tool hardening
- **Phase 4** — Scaler design brief baked into system prompt
- **Phase 5** — Agent loop hardening (forced decomposition + self-review)
- **Phase 6** — Polish, README, demo video

## License

MIT
