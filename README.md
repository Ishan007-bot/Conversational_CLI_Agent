# Scaler Clone CLI Agent

A conversational CLI agent (in the spirit of Cursor / Windsurf) that takes a natural-language instruction in your terminal, reasons step-by-step, and produces a working local clone of the Scaler Academy website using HTML, CSS, and vanilla JavaScript.

> Status: **End-to-end Scaler clone produced**. The agent walks the full workflow (fetch → think → batch write → self-review → open in browser), and the output site renders cleanly in `output/scaler-clone/`.

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
| `writeFiles({files: [...]})` | Batch-write several files in one tool call (token-efficient). |
| `readFile({path})` | Read a file back (used for self-review). |
| `listFiles({dir})` | List directory entries. |
| `createFolder({path})` | Recursive mkdir. |
| `pathExists({path})` | Probe whether a file or directory exists. |
| `openInBrowser({path})` | Open a local file in the default browser (Windows / macOS / Linux). |

All file-system tools resolve paths against the workspace root (project directory by default, override with `AGENT_WORKSPACE_ROOT`). Paths that try to escape (`../../etc/passwd`) are rejected at the tool boundary.
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

### Multi-key rotation (Groq free tier)

Each Groq account has its own 100K-tokens-per-day budget on the free tier. To extend that, set `GROQ_API_KEYS` to a comma-separated list:

```
GROQ_API_KEYS=gsk_first,gsk_second,gsk_third
```

When the agent hits a `tokens per day` error on the active key, it rotates to the next key automatically and retries the same request — no run is lost. You'll see a `[KEYROTATE 1→2/3]` log line. Per-minute rate limits still trigger a wait-and-retry on the same key (they reset within ~60 seconds, so rotating doesn't help).

`GROQ_API_KEY` and `GROQ_API_KEYS` are merged and deduped, so you can set either or both.

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

## Generated example

A finished Scaler clone produced by the agent lives in [`output/scaler-clone/`](output/scaler-clone/). To regenerate from scratch:

```bash
npm start
```

…then paste:

> Clone the Scaler Academy website at https://www.scaler.com into ./output/scaler-clone, following the SCALER ACADEMY CLONE TASK BRIEF in your system prompt exactly. Required sections: Header, Hero, Footer.

The agent will fetch the live page, decompose into folder + writeFiles + readFile self-review, and open the result in your default browser. Multi-turn follow-ups like *"now make the hero darker"* work because conversation history persists across turns.

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
- **Phase 3** — File-system tool hardening (workspace-root path safety + `pathExists` + `writeFiles` batch) ✅
- **Phase 4** — Scaler design brief baked into system prompt (workflow, design tokens, section specs, code constraints) ✅
- **Phase 5** — Agent loop hardening (rate-limit retry + multi-key rotation + structured fetch) and end-to-end clone test ✅
- **Phase 6** — Polish, README, demo video

## License

MIT
