import { OpenAI } from "openai";
import chalk from "chalk";
import { SYSTEM_PROMPT } from "./prompts/system.js";
import {
  writeFile,
  readFile,
  listFiles,
  createFolder,
  openInBrowser,
} from "./tools/fs.js";
import { executeCommand } from "./tools/shell.js";
import {
  fetchWebpage,
  getTheWeatherOfCity,
  getGithubDetailsAboutUser,
} from "./tools/web.js";

const tool_map = {
  fetchWebpage,
  writeFile,
  readFile,
  listFiles,
  createFolder,
  openInBrowser,
  executeCommand,
  getTheWeatherOfCity,
  getGithubDetailsAboutUser,
};

const MAX_ITERATIONS = 80;

function buildClient() {
  const provider = (process.env.LLM_PROVIDER || "groq").toLowerCase();
  if (provider === "groq") {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error(
        "GROQ_API_KEY is not set. Copy .env.example to .env and fill it in. " +
          "Get a free key at https://console.groq.com/keys"
      );
    }
    return {
      client: new OpenAI({
        apiKey,
        baseURL: "https://api.groq.com/openai/v1",
      }),
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
      provider: "groq",
    };
  }
  if (provider === "openai") {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY is not set. Copy .env.example to .env and fill it in."
      );
    }
    return {
      client: new OpenAI({ apiKey }),
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      provider: "openai",
    };
  }
  throw new Error(
    `Unknown LLM_PROVIDER="${provider}". Use "groq" or "openai".`
  );
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
  const { client, model, provider } = buildClient();
  if (history.length === 0) {
    console.log(chalk.gray(`(provider: ${provider}, model: ${model})`));
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
    try {
      response = await client.chat.completions.create({
        model,
        messages,
        response_format: { type: "json_object" },
        temperature: 0.2,
      });
    } catch (err) {
      console.log(chalk.red("[API ERROR]"), err.message || err);
      return { history: messages, output: null, error: err.message };
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
