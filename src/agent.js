import { OpenAI } from "openai";
import chalk from "chalk";
import { SYSTEM_PROMPT } from "./prompts/system.js";
import {
  writeFile,
  writeFiles,
  readFile,
  listFiles,
  createFolder,
  openInBrowser,
  pathExists,
} from "./tools/fs.js";
import { validateGeneratedFiles } from "./tools/validate.js";
import { executeCommand } from "./tools/shell.js";
import {
  fetchWebpage,
  getTheWeatherOfCity,
  getGithubDetailsAboutUser,
} from "./tools/web.js";

const tool_map = {
  fetchWebpage,
  writeFile,
  writeFiles,
  readFile,
  listFiles,
  createFolder,
  pathExists,
  openInBrowser,
  executeCommand,
  validateGeneratedFiles,
  getTheWeatherOfCity,
  getGithubDetailsAboutUser,
};

const MAX_ITERATIONS = 80;

function collectKeys(singleVar, multiVar) {
  const single = process.env[singleVar]?.trim();
  const multi = (process.env[multiVar] || "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  return [...new Set([single, ...multi].filter(Boolean))];
}

function buildOneProvider(provider) {
  if (provider === "groq") {
    const keys = collectKeys("GROQ_API_KEY", "GROQ_API_KEYS");
    if (keys.length === 0) return null;
    return {
      provider: "groq",
      keys,
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      baseURL: "https://api.groq.com/openai/v1",
    };
  }
  if (provider === "gemini") {
    const keys = collectKeys("GEMINI_API_KEY", "GEMINI_API_KEYS");
    if (keys.length === 0) return null;
    return {
      provider: "gemini",
      keys,
      model: process.env.GEMINI_MODEL || "gemini-2.0-flash",
      baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
    };
  }
  if (provider === "openrouter") {
    const keys = collectKeys("OPENROUTER_API_KEY", "OPENROUTER_API_KEYS");
    if (keys.length === 0) return null;
    return {
      provider: "openrouter",
      keys,
      model:
        process.env.OPENROUTER_MODEL ||
        "meta-llama/llama-3.3-70b-instruct:free",
      baseURL: "https://openrouter.ai/api/v1",
    };
  }
  if (provider === "openai") {
    const keys = collectKeys("OPENAI_API_KEY", "OPENAI_API_KEYS");
    if (keys.length === 0) return null;
    return {
      provider: "openai",
      keys,
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      baseURL: undefined,
    };
  }
  return null;
}

function buildProviders() {
  const primary = (process.env.LLM_PROVIDER || "groq").toLowerCase();
  const known = ["groq", "gemini", "openrouter", "openai"];
  if (!known.includes(primary)) {
    throw new Error(
      `Unknown LLM_PROVIDER="${primary}". Use "groq", "gemini", "openrouter", or "openai".`
    );
  }
  const order = [primary, ...known.filter((p) => p !== primary)];
  const configured = order.map(buildOneProvider).filter(Boolean);
  if (configured.length === 0) {
    throw new Error(
      `No API keys configured. Set ${primary.toUpperCase()}_API_KEY in .env (or another provider's key).`
    );
  }
  return configured;
}

function parseWaitSeconds(msg, fallback) {
  const s = msg.match(/try again in\s+([\d.]+)\s*s\b/i);
  if (s) return Math.ceil(parseFloat(s[1])) + 1;
  const hms = msg.match(/try again in\s+(?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/i);
  if (hms && (hms[1] || hms[2] || hms[3])) {
    const h = parseInt(hms[1] || "0");
    const m = parseInt(hms[2] || "0");
    const sec = Math.ceil(parseFloat(hms[3] || "0"));
    return h * 3600 + m * 60 + sec;
  }
  return fallback;
}

function truncate(s, n = 220) {
  if (typeof s !== "string") s = String(s);
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function printStep(parsed) {
  switch (parsed.step) {
    case "START":
      console.log(chalk.bold.magenta("\n[START]"), parsed.content || "");
      break;
    case "THINK":
      console.log(chalk.cyan("[THINK]"), parsed.content || "");
      break;
    case "TOOL": {
      const argPreview =
        typeof parsed.tool_args === "string"
          ? parsed.tool_args
          : JSON.stringify(parsed.tool_args);
      console.log(
        chalk.yellow(`[TOOL ] ${parsed.tool_name}`),
        chalk.gray(truncate(argPreview, 160))
      );
      break;
    }
    case "OUTPUT":
      console.log(chalk.bold.greenBright("\n[OUTPUT]"), parsed.content || "");
      break;
    default:
      console.log(chalk.red("[?]"), JSON.stringify(parsed));
  }
}

export async function runAgent(userMessage, history = []) {
  const providers = buildProviders();
  let pIdx = 0;
  let kIdx = 0;
  const exhausted = new Set(); // "pIdx:kIdx" — slot is dead for this run (daily quota)

  const slotKey = () => `${pIdx}:${kIdx}`;
  const totalSlots = () => providers.reduce((n, p) => n + p.keys.length, 0);
  const slotLabel = () =>
    `${providers[pIdx].provider}#${kIdx + 1}/${providers[pIdx].keys.length}`;

  const makeClient = () => {
    const p = providers[pIdx];
    return new OpenAI({
      apiKey: p.keys[kIdx],
      ...(p.baseURL ? { baseURL: p.baseURL } : {}),
    });
  };

  // Walk to the next non-exhausted slot. Returns true if we moved, false if every slot is exhausted.
  const advanceSlot = () => {
    const total = totalSlots();
    let np = pIdx;
    let nk = kIdx;
    for (let step = 0; step < total; step++) {
      nk++;
      if (nk >= providers[np].keys.length) {
        nk = 0;
        np = (np + 1) % providers.length;
      }
      if (!exhausted.has(`${np}:${nk}`)) {
        pIdx = np;
        kIdx = nk;
        return true;
      }
    }
    return false;
  };

  let client = makeClient();
  if (history.length === 0) {
    const summary = providers
      .map(
        (p) =>
          `${p.provider}(${p.keys.length} key${p.keys.length > 1 ? "s" : ""})`
      )
      .join(" → ");
    console.log(
      chalk.gray(
        `(primary: ${providers[0].provider}, model: ${providers[0].model}; fallback chain: ${summary})`
      )
    );
  }

  const messages =
    history.length === 0
      ? [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ]
      : [...history, { role: "user", content: userMessage }];

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let response;
    let attempt = 0;
    while (true) {
      try {
        response = await client.chat.completions.create({
          model: providers[pIdx].model,
          messages,
          response_format: { type: "json_object" },
          temperature: 0.2,
        });
        break;
      } catch (err) {
        const status = err?.status || err?.response?.status;
        const msg = err?.message || String(err);
        const isDailyExhaust =
          /tokens per day/i.test(msg) ||
          /requests per day/i.test(msg) ||
          /quota.*exceed/i.test(msg) ||
          /daily.*limit/i.test(msg);
        const isRateLimit =
          status === 429 ||
          status === 413 ||
          /rate.?limit/i.test(msg) ||
          /tokens per (minute|hour|day)/i.test(msg) ||
          /Request too large/i.test(msg);

        // Slot is dead for the rest of this run — mark exhausted and try to advance.
        if (isDailyExhaust) {
          exhausted.add(slotKey());
          const prev = slotLabel();
          if (advanceSlot()) {
            console.log(
              chalk.yellow(
                `[ROTATE] daily quota on ${prev} — switching to ${slotLabel()}`
              )
            );
            client = makeClient();
            attempt = 0;
            continue;
          }
          console.log(
            chalk.red(`[API ERROR] all configured keys exhausted: ${msg}`)
          );
          return { history: messages, output: null, error: msg };
        }

        // Per-minute/short rate limit — prefer to switch sideways immediately rather than wait,
        // if any other slot is available.
        if (isRateLimit && totalSlots() - exhausted.size > 1) {
          const prev = slotLabel();
          if (advanceSlot()) {
            console.log(
              chalk.yellow(
                `[ROTATE] rate-limited on ${prev} (${status || "?"}) — switching to ${slotLabel()}`
              )
            );
            client = makeClient();
            attempt = 0;
            continue;
          }
        }

        if (!isRateLimit || attempt >= 3) {
          console.log(chalk.red("[API ERROR]"), msg);
          return { history: messages, output: null, error: msg };
        }

        const waitSec = Math.min(75, parseWaitSeconds(msg, 35 * (attempt + 1)));
        console.log(
          chalk.yellow(
            `[RATELIMIT] ${status || "?"} on ${slotLabel()} — waiting ${waitSec}s (attempt ${attempt + 1}/3)`
          )
        );
        await new Promise((r) => setTimeout(r, waitSec * 1000));
        attempt++;
      }
    }

    const raw = response.choices?.[0]?.message?.content ?? "";
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.log(chalk.red("[PARSE ERROR] model returned invalid JSON, asking it to retry"));
      messages.push({ role: "assistant", content: raw });
      messages.push({
        role: "user",
        content: JSON.stringify({
          step: "OBSERVE",
          content:
            "Your previous response was not valid JSON. Reply with exactly one valid JSON object matching the protocol.",
        }),
      });
      continue;
    }

    messages.push({ role: "assistant", content: JSON.stringify(parsed) });
    printStep(parsed);

    if (parsed.step === "OUTPUT") {
      return { history: messages, output: parsed.content };
    }

    if (parsed.step === "TOOL") {
      const tool = tool_map[parsed.tool_name];
      let observation;
      if (!tool) {
        observation = `Tool "${parsed.tool_name}" is not available. Available tools: ${Object.keys(
          tool_map
        ).join(", ")}`;
      } else {
        try {
          const result = await tool(parsed.tool_args);
          observation =
            typeof result === "string" ? result : JSON.stringify(result);
        } catch (err) {
          observation = `Tool error: ${err.message || err}`;
        }
      }
      console.log(chalk.green("[OBSRV]"), chalk.gray(truncate(observation, 220)));
      messages.push({
        role: "user",
        content: JSON.stringify({ step: "OBSERVE", content: observation }),
      });
    }
  }

  console.log(chalk.red(`[STOP] max iterations (${MAX_ITERATIONS}) reached`));
  return { history: messages, output: null };
}
