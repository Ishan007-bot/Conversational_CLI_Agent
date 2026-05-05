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

Then open `.env` and configure **one** provider:

| Provider | Cost | Default model | Where to get a key |
|---|---|---|---|
| **Groq** (default) | Free, 100K tokens/day per model | `llama-3.3-70b-versatile` | https://console.groq.com/keys |
| **OpenAI** | Paid, ~$0.15 per 1M input tokens | `gpt-4o-mini` | https://platform.openai.com/api-keys |
| **OpenRouter** | Free models available | `meta-llama/llama-3.3-70b-instruct:free` | https://openrouter.ai/keys |

The agent uses the OpenAI SDK against each provider's chat-completions endpoint, so the rest of the code is provider-agnostic. Switching is a single env-var change.

### Multi-key rotation (Groq free tier)

Each Groq account has its own 100K-tokens-per-day budget. To extend that, set `GROQ_API_KEYS` to a comma-separated list:

```
GROQ_API_KEYS=gsk_first,gsk_second,gsk_third
```

When the agent hits a `tokens per day` error on the active key, it marks that key exhausted and rotates to the next one in the pool. The same request retries on the new key — no conversation state is lost. You'll see a `[KEYROTATE 1→2/3]` line in the console.

Per-minute rate limits still wait-and-retry on the same key (since they reset within seconds, rotating doesn't help). The agent parses `try again in 12.3s` hints from error bodies and uses them as the wait time, capped at 75 seconds.

`GROQ_API_KEY` and `GROQ_API_KEYS` are merged and deduped, so you can set either or both.

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

## Generated example

A finished Scaler clone produced by the agent lives in [`output/scaler-clone/`](output/scaler-clone/). It includes:

- **Sticky white header** — Scaler wordmark, primary nav (Programs / Companies / Events / Blog), Login link, Apply Now CTA, hamburger button for mobile, scroll-shadow class added by JS
- **Dark gradient hero** — eyebrow chip, the real `Become the Professional Built for the Next Decade in AI.` headline pulled from scaler.com via `fetchWebpage`, lead paragraph, primary + ghost CTAs, trust line, glass-morphism card on the right with traffic-light dots and a play button
- **Four-column dark footer** — Company / Programs / Resources / Reach Out, brand row with tagline, copyright, four inline-SVG social icons in pill backgrounds
- **Responsive** — desktop two-column → tablet stack at 768px → footer single-column at 480px
- **JS interactions** — header scroll-shadow, hamburger toggle, smooth in-page anchor scroll, all wrapped in an IIFE with null guards

The validator reports `ok: true` on this output. To regenerate from scratch, delete the folder and re-run `npm start` with the Scaler clone prompt.

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
└── output/
    └── scaler-clone/         Example agent output (committed for reference)
        ├── index.html
        ├── style.css
        └── script.js
```

## Configuration reference

| Env var | Default | Notes |
|---|---|---|
| `LLM_PROVIDER` | `groq` | One of `groq`, `openai`, `openrouter` |
| `GROQ_API_KEY` | — | Single Groq key |
| `GROQ_API_KEYS` | — | Comma-separated pool of Groq keys for rotation |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Any Groq chat model with JSON mode |
| `OPENAI_API_KEY` | — | Required when `LLM_PROVIDER=openai` |
| `OPENAI_MODEL` | `gpt-4o-mini` | Any chat-completions OpenAI model |
| `OPENROUTER_API_KEY` | — | Required when `LLM_PROVIDER=openrouter` |
| `OPENROUTER_MODEL` | `meta-llama/llama-3.3-70b-instruct:free` | Any OpenRouter slug |
| `AGENT_WORKSPACE_ROOT` | `process.cwd()` | Path-safety boundary for file-system tools |

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

**`OPENAI_API_KEY is not set` / `GROQ_API_KEY is not set`** — copy `.env.example` to `.env` and fill in the key for whichever provider you set in `LLM_PROVIDER`.

**`Rate limit reached … tokens per day`** — Groq's free tier exhausted for today. Either wait for the per-day reset, add a second key via `GROQ_API_KEYS`, or switch provider with `LLM_PROVIDER=openai` or `LLM_PROVIDER=openrouter`.

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
