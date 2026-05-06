# Conversational CLI Agent

A conversational CLI agent — in the spirit of Cursor / Windsurf — that takes natural-language instructions in your terminal, reasons step-by-step through a tool-using loop, and produces real local output files. The default task it is tuned for is cloning the Scaler Academy website into a working static page (`index.html` + `style.css` + `script.js`) that opens in your browser.

The agent is also general-purpose: it can fetch any web page, read and write files, run shell commands, validate generated code, and answer free-form questions. The Scaler-specific brief only activates when you mention Scaler in your prompt.

## Quickstart

```bash
git clone https://github.com/Ishan007-bot/Conversational_CLI_Agent.git
cd Conversational_CLI_Agent
npm install
cp .env.example .env       # add your API key inside (Groq is free)
npm start
```

You'll see a `you >` prompt. Type:

> Clone the Scaler Academy website at https://www.scaler.com into ./output/scaler-clone, following the SCALER ACADEMY CLONE TASK BRIEF in your system prompt exactly. Required sections: Header, Hero, Footer.

The agent will reason through the task, write three files into `output/scaler-clone/`, and open the result in your default browser.

## How it works

The agent runs in a strict, structured loop:

```
START → THINK → TOOL → OBSERVE → THINK → TOOL → OBSERVE → ... → OUTPUT
```

Every model turn produces exactly one JSON object describing the next step. When the model calls a tool, the runtime executes it locally, captures the result, and feeds it back as an `OBSERVE` message. The loop continues until the model emits `OUTPUT`.

The protocol is enforced by:

- A system prompt that documents the JSON shape and the tool catalog
- `response_format: { type: "json_object" }` on every chat completion call
- A `MAX_ITERATIONS = 80` guard against runaway loops
- Try/catch on `JSON.parse` with a re-prompt on parse failure

For the Scaler task specifically, the system prompt activates an additional **task brief** that forces a 7-step decomposition: fetch the live page → think about extracted content → create the folder → batch-write all three files → run the validator → fix any reported problems → open in browser → output a summary.

### Reasoning trace example

```
[START]   User wants to clone the Scaler Academy website
[THINK]   To clone, I need to fetch its actual HTML first
[TOOL]    fetchWebpage  →  https://www.scaler.com
[OBSRV]   structured extract: title, H1, nav links, buttons, footer links, colors, image URLs
[THINK]   Mapping the real Scaler headline and CTAs onto the design system
[TOOL]    createFolder  →  ./output/scaler-clone
[OBSRV]   Folder created
[TOOL]    writeFiles    →  index.html + style.css + script.js (one batch call)
[OBSRV]   Wrote 3 files: 7152b + 9966b + 1484b
[TOOL]    validateGeneratedFiles
[OBSRV]   { ok: true, problems: [], warnings: [...] }
[TOOL]    openInBrowser
[OBSRV]   Opened
[OUTPUT]  Cloned scaler.com into ./output/scaler-clone — sticky header, dark hero, 4-col footer
```

## Tool catalog

The agent has access to eleven tools. They are documented in the system prompt with their exact argument shape so the model can call them correctly.

| Tool | Purpose |
| --- | --- |
| `fetchWebpage(url)` | Fetch a URL and return a structured extract — title, OG title, meta description, H1/H2/H3 lists, nav link labels, button labels, footer link labels, image URLs, stylesheet URLs, deduped color palette — plus a stripped HTML body. SPA `__NEXT_DATA__` JSON is preserved. Caps the response at ~12 KB so a long agent loop stays inside per-minute token budgets. |
| `writeFile({path, content})` | Create or overwrite a file. Auto-creates parent directories. |
| `writeFiles({files: [...]})` | Batch-write several files in one tool call. Halves the round-trip cost when generating a site from scratch. |
| `readFile({path})` | Read a file and return its contents. Used for self-review. |
| `listFiles({dir})` | List entries in a directory. |
| `createFolder({path})` | Recursive `mkdir -p`. |
| `pathExists({path})` | Probe a path. Returns `{exists, type, size, path}`. |
| `openInBrowser({path})` | Open a local file in the OS default browser. Cross-platform — uses `start ""` on Windows, `open` on macOS, `xdg-open` on Linux. |
| `executeCommand(cmd)` | Run a shell command and return its stdout. |
| `validateGeneratedFiles({dir})` | Static-analyse a generated site directory. Returns JSON with `problems`, `warnings`, and `stats`. Catches missing files, missing semantic tags (`header`/`main`/`section`/`footer`), missing hero `<h1>`, missing CTA buttons, missing responsive `@media` queries, lorem-ipsum placeholder text, CSS classes with no matching HTML, and JavaScript references to IDs/classes that don't exist in the markup. |
| `getTheWeatherOfCity(city)` | Live weather lookup via wttr.in. |
| `getGithubDetailsAboutUser(user)` | Public GitHub profile info. |

All file-system tools resolve paths against a workspace root (the project directory by default, override with the `AGENT_WORKSPACE_ROOT` env var). Paths that try to escape the workspace (`../../etc/passwd`, absolute paths outside the root) are rejected at the tool boundary.

## Setup

```bash
npm install
cp .env.example .env
```

Set `LLM_PROVIDER` to your preferred primary, then add a key for it. You can also fill in keys for any other provider — they become **automatic fallbacks** when the primary's daily quota is exhausted, so a single `.env` with two or three providers' keys never hits a hard wall.

| Provider | Cost | Default model | Where to get a key |
|---|---|---|---|
| **Groq** (default primary) | Free, 100K tokens/day per model | `llama-3.3-70b-versatile` | https://console.groq.com/keys |
| **Gemini** | Free, generous daily quota | `gemini-2.0-flash` | https://aistudio.google.com/app/apikey |
| **OpenRouter** | Free models available | `meta-llama/llama-3.3-70b-instruct:free` | https://openrouter.ai/keys |
| **OpenAI** | Paid, ~$0.15 per 1M input tokens | `gpt-4o-mini` | https://platform.openai.com/api-keys |

The agent uses the OpenAI SDK against each provider's chat-completions endpoint, so the rest of the code is provider-agnostic. Switching the primary is a single env-var change.

### Multi-key rotation and cross-provider fallback

Every provider supports a key pool. Set `<PROVIDER>_API_KEY` for a single key, `<PROVIDER>_API_KEYS` for a comma-separated list, or both — they merge and dedupe.

```
GROQ_API_KEYS=gsk_first,gsk_second
GEMINI_API_KEY=AIza_personal
GEMINI_API_KEYS=AIza_workspace_alt
```

When the active key fails:

- **Daily quota** errors (`tokens per day`, `quota exceeded`, `requests per day`) — the slot is marked dead for the rest of the run, and the agent rotates to the next key in the same provider's pool, then to the next provider's pool, in primary-first order.
- **Per-minute** rate limits — if any other configured slot exists, the agent rotates sideways immediately rather than waiting. If no other slot is free, it parses `try again in 12.3s` hints from the error and waits, capped at 75 seconds.

You'll see `[ROTATE]` lines in the console showing the switch:

```
[ROTATE] daily quota on groq#1/2 — switching to groq#2/2
[ROTATE] daily quota on groq#2/2 — switching to gemini#1/1
[ROTATE] rate-limited on gemini#1/1 (429) — switching to openrouter#1/1
```

This makes the agent robust to free-tier quirks without the user having to babysit `.env`.

## Running the agent

```bash
npm start
```

You get a colored banner and a `you >` prompt. Type any request:

```
you > what's the weather in Mumbai?
you > use executeCommand to run 'node --version'
you > clone https://www.scaler.com into ./output/scaler-clone
you > now make the hero gradient darker
```

Multi-turn history persists across prompts, so follow-ups like *"now make the hero darker"* work after an initial build.

### Slash commands

| Command | Effect |
| --- | --- |
| `/help` (or `/?`) | Show the command reference |
| `/clear` | Reset conversation history |
| `/history` | Print how many messages are in history |
| `/save <file>` | Write the full conversation JSON to `<file>` |
| `/exit` (or `/q`, `/quit`) | Leave the agent |

### Other scripts

```bash
# Live API smoke test (verifies provider + tool wiring with a real model call)
npm run smoke

# Offline structural self-check — verifies all tools work, including the validator,
# without making any API calls. Safe to run without an API key.
npm run selfcheck
```

The selfcheck covers writeFile/readFile roundtrips, `pathExists` true/false cases, `writeFiles` batch, workspace-escape rejection, `executeCommand`, `fetchWebpage` against example.com, and the validator against deliberately-broken and clean HTML/CSS/JS fixtures.

## Generated output

The agent writes generated sites into a local `output/` directory at runtime. That directory is git-ignored, so the repo stays small — every clone session starts fresh on your machine.

A typical Scaler clone run produces three files inside `output/scaler-clone/`:

- **`index.html`** — semantic markup with `<header>`, `<nav>`, `<main>`, `<section class="hero">`, `<footer>`, real Scaler hero copy from `fetchWebpage`, four-column footer link grid, inline-SVG social icons
- **`style.css`** — `:root` design-token palette, sticky white header with scroll-shadow class, dark gradient hero with two-column layout collapsing at 768px, glass-morphism card on the right, four-column footer collapsing to two then one column on smaller breakpoints
- **`script.js`** — IIFE wrapping a `DOMContentLoaded` handler that toggles `.scrolled` on the header, opens/closes the mobile hamburger, and smooth-scrolls in-page anchors with null guards

The validator should report `ok: true` once the agent finishes. To regenerate, delete the folder and re-run `npm start` with the Scaler clone prompt.

## Project layout

```
.
├── README.md
├── .env.example
├── .gitignore
├── package.json
├── package-lock.json
├── src/
│   ├── index.js              REPL entry — readline loop, slash commands, line serialization
│   ├── agent.js              START/THINK/TOOL/OBSERVE/OUTPUT loop, provider abstraction, key rotation, rate-limit retry
│   ├── smoke.js              Live API smoke test
│   ├── selfcheck.js          Offline structural test — no API key required
│   ├── prompts/
│   │   └── system.js         System prompt: protocol rules, tool catalog, Scaler design brief
│   └── tools/
│       ├── fs.js             writeFile, writeFiles, readFile, listFiles, createFolder, pathExists, openInBrowser
│       ├── shell.js          executeCommand
│       ├── web.js            fetchWebpage (with structured extract), getTheWeatherOfCity, getGithubDetailsAboutUser
│       └── validate.js       validateGeneratedFiles — static analysis of generated sites
└── output/                   Runtime working directory — gitignored, populated by the agent
```

## Configuration reference

| Env var | Default | Notes |
|---|---|---|
| `LLM_PROVIDER` | `groq` | Primary provider — one of `groq`, `gemini`, `openrouter`, `openai`. Other providers with keys configured become automatic fallbacks. |
| `GROQ_API_KEY` / `GROQ_API_KEYS` | — | Single key, or comma-separated pool. Both are merged. |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Any Groq chat model with JSON mode. |
| `GEMINI_API_KEY` / `GEMINI_API_KEYS` | — | Free at https://aistudio.google.com/app/apikey. |
| `GEMINI_MODEL` | `gemini-2.0-flash` | Try `gemini-2.5-flash` if your account has zero quota on 2.0. |
| `OPENROUTER_API_KEY` / `OPENROUTER_API_KEYS` | — | OpenRouter key(s). |
| `OPENROUTER_MODEL` | `meta-llama/llama-3.3-70b-instruct:free` | Any OpenRouter slug. |
| `OPENAI_API_KEY` / `OPENAI_API_KEYS` | — | OpenAI key(s) — used as a paid fallback. |
| `OPENAI_MODEL` | `gpt-4o-mini` | Any chat-completions OpenAI model. |
| `AGENT_WORKSPACE_ROOT` | `process.cwd()` | Path-safety boundary for file-system tools. |

## Assignment requirement mapping

| Requirement | Implementation |
| --- | --- |
| Conversational CLI runs in terminal | `src/index.js` — `readline` REPL with `you >` prompt |
| Accepts natural-language instructions | Free-form prompts piped into the agent loop, multi-turn history retained |
| Agent reasons through the task | START / multiple THINK / TOOL / OBSERVE / OUTPUT enforced by system prompt and JSON-mode responses |
| Must not finish in one step | 7-step Scaler workflow (fetch, think, create, batch-write, validate, fix, open, summarize); `MAX_ITERATIONS=80` |
| Takes actions / produces real files | Tools write to disk, run shell, fetch web, validate, open browser |
| Output is HTML + CSS + JS | `output/scaler-clone/{index.html, style.css, script.js}` |
| Must include Header, Hero, Footer | All three present and styled in the generated output |
| Visually resembles Scaler | Brand blue/navy gradient, Inter font, real Scaler hero copy from `fetchWebpage`, design-token CSS |
| Code Quality & Documentation | Modular `src/tools/` layout, validator, selfcheck + smoke scripts, this README, `.env.example`, `.gitignore` |

## Troubleshooting

**`No API keys configured`** — copy `.env.example` to `.env` and fill in at least one provider's key. The agent will pick it up automatically.

**`Rate limit reached … tokens per day`** — the active provider's daily budget is gone. The agent will print a `[ROTATE]` line and switch to the next configured provider automatically. If all configured providers are exhausted, add another provider's key in `.env` (Groq, Gemini, and OpenRouter all have free tiers) and re-run.

**`Quota exceeded for metric: …generate_content_free_tier_requests, limit: 0, model: gemini-2.0-flash`** — your Google account has zero free quota on that specific Gemini model. Switch `GEMINI_MODEL` to `gemini-2.5-flash` (different quota pool) and re-run.

**`429 Provider returned error … temporarily rate-limited upstream`** (OpenRouter) — the upstream provider for that free model is congested. Try a different free model by setting `OPENROUTER_MODEL` to another slug (the model list at https://openrouter.ai/models?fmt=table&supported_parameters=response_format shows which support JSON mode).

**Browser doesn't open** — run `node -e "require('./src/tools/fs.js').openInBrowser({path:'./output/scaler-clone/index.html'})"` and check the error, or open the file manually from your file explorer.

**`npm` blocked in PowerShell** — use `npm.cmd install` and `npm.cmd start`, or run `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once.

**Validator reports a `warnings` line about classes added by JS at runtime (`scrolled`, `open`)** — expected. Those classes are toggled by `script.js` on scroll / hamburger click; they're not in the static HTML.

**Model returns invalid JSON** — the agent already retries once with a corrective prompt. If a particular model drifts repeatedly, try a stronger one (`gpt-4o-mini` and `llama-3.3-70b-versatile` both follow the protocol reliably; smaller models may not).

## Limitations

- The clone is a static approximation, not a full production copy. Modern SPA sites that render content via client-side JavaScript will only have what's in the initial HTML payload.
- `fetchWebpage` does not follow links or render JavaScript, so deep crawls are out of scope.
- LLM output quality depends on the model and the available rate-limit budget.
- External image URLs in the structured extract may break if the source site changes.
- Intended for educational use and assignment demonstration.

## License

MIT
