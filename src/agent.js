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

function buildClientConfig() {
  const provider = (process.env.LLM_PROVIDER || "groq").toLowerCase();
  if (provider === "groq") {
    const single = process.env.GROQ_API_KEY?.trim();
    const multi = (process.env.GROQ_API_KEYS || "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    const keys = [...new Set([single, ...multi].filter(Boolean))];
    if (keys.length === 0) {
      throw new Error(
        "No Groq API key configured. Set GROQ_API_KEY (or GROQ_API_KEYS) in .env. " +
          "Get a free key at https://console.groq.com/keys"
      );
    }
    return {
      keys,
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      provider: "groq",
      baseURL: "https://api.groq.com/openai/v1",
    };
  }
  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY is not set. Copy .env.example to .env and fill it in."
      );
    }
    return {
      keys: [apiKey],
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      provider: "openai",
      baseURL: undefined,
    };
  }
  if (provider === "openrouter") {
    const apiKey = process.env.OPENROUTER_API_KEY?.trim();
    if (!apiKey) {
      throw new Error(
        "OPENROUTER_API_KEY is not set. Get a free key at https://openrouter.ai/keys"
      );
    }
    return {
      keys: [apiKey],
      model: process.env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free",
      provider: "openrouter",
      baseURL: "https://openrouter.ai/api/v1",
    };
  }
  throw new Error(
    `Unknown LLM_PROVIDER="${provider}". Use "groq", "openai", or "openrouter".`
  );
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
  const { keys, model, provider, baseURL } = buildClientConfig();
  let keyIdx = 0;
  const exhausted = new Set();
  const makeClient = () =>
    new OpenAI({ apiKey: keys[keyIdx], ...(baseURL ? { baseURL } : {}) });
  let client = makeClient();
  if (history.length === 0) {
    const keyInfo = keys.length > 1 ? `, ${keys.length} keys` : "";
    console.log(chalk.gray(`(provider: ${provider}, model: ${model}${keyInfo})`));
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
          model,
          messages,
          response_format: { type: "json_object" },
          temperature: 0.2,
        });
        break;
      } catch (err) {
        const status = err?.status || err?.response?.status;
        const msg = err?.message || String(err);
        const isTpd = /tokens per day/i.test(msg);
        const isRateLimit =
          status === 429 ||
          status === 413 ||
          /rate.?limit/i.test(msg) ||
          /tokens per (minute|hour|day)/i.test(msg) ||
          /Request too large/i.test(msg);

        if (isTpd) {
          exhausted.add(keyIdx);
          const nextIdx = keys.findIndex((_, idx) => !exhausted.has(idx));
          if (nextIdx >= 0 && nextIdx !== keyIdx) {
            console.log(
              chalk.yellow(
                `[KEYROTATE] daily quota exhausted on key ${keyIdx + 1}/${keys.length}, switching to key ${nextIdx + 1}/${keys.length}`
              )
            );
            keyIdx = nextIdx;
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
            `[RATELIMIT] ${status || "?"} — waiting ${waitSec}s (attempt ${attempt + 1}/3, key ${keyIdx + 1}/${keys.length})`
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
