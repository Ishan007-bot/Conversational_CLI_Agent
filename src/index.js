import "dotenv/config";
import readline from "readline";
import fs from "fs/promises";
import path from "path";
import chalk from "chalk";
import { runAgent } from "./agent.js";

const PROMPT = chalk.bold.white("\nyou > ");

function banner() {
  console.log(
    `\n${chalk.bold.cyan("Scaler Clone CLI Agent")}  ${chalk.gray("(conversational mode)")}`
  );
  console.log(chalk.gray("Type a prompt to talk to the agent, or use a slash command."));
  console.log(
    chalk.gray("Slash commands: ") +
      chalk.cyan("/help  /clear  /save <file>  /history  /exit")
  );
}

function showHelp() {
  console.log(`
${chalk.bold("Commands")}
  ${chalk.cyan("/help")}            show this help
  ${chalk.cyan("/clear")}           reset the conversation history
  ${chalk.cyan("/history")}         show how many messages are in history
  ${chalk.cyan("/save <file>")}     save full conversation JSON to <file>
  ${chalk.cyan("/exit")} (or /q)    leave the agent

Anything else is sent to the agent as a prompt.
The agent retains conversation history across turns, so follow-ups like
"now make the hero darker" work after an initial build instruction.
`);
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: PROMPT,
  terminal: true,
});

let history = [];
let processing = Promise.resolve();

async function handleSlash(line) {
  const [cmd, ...rest] = line.trim().split(/\s+/);
  switch (cmd) {
    case "/help":
    case "/?":
      showHelp();
      return true;

    case "/clear":
      history = [];
      console.log(chalk.gray("(conversation history cleared)"));
      return true;

    case "/history": {
      const n = history.length;
      console.log(
        chalk.gray(
          n === 0
            ? "(no history yet)"
            : `(${n} messages in history; system+user+assistant turns combined)`
        )
      );
      return true;
    }

    case "/save": {
      const target =
        rest.join(" ").trim() ||
        path.join(".", `conversation-${Date.now()}.json`);
      try {
        await fs.mkdir(path.dirname(path.resolve(target)), { recursive: true });
        await fs.writeFile(
          target,
          JSON.stringify(history, null, 2),
          "utf-8"
        );
        console.log(chalk.green(`saved ${history.length} messages to ${target}`));
      } catch (e) {
        console.log(chalk.red(`save failed: ${e.message}`));
      }
      return true;
    }

    case "/exit":
    case "/quit":
    case "/q":
      console.log(chalk.gray("bye"));
      rl.close();
      return true;
  }

  if (cmd.startsWith("/")) {
    console.log(chalk.red(`unknown command: ${cmd}`) + chalk.gray("  — try /help"));
    return true;
  }
  return false;
}

banner();
rl.prompt();

async function handleLine(line) {
  const trimmed = line.trim();
  if (!trimmed) {
    rl.prompt();
    return;
  }

  if (await handleSlash(trimmed)) {
    rl.prompt();
    return;
  }

  try {
    const res = await runAgent(trimmed, history);
    history = res.history;
    if (!res.output) {
      console.log(chalk.red("(agent returned no OUTPUT — check errors above)"));
    }
  } catch (e) {
    console.log(chalk.red(`agent error: ${e.message}`));
  }
  rl.prompt();
}

rl.on("line", (line) => {
  processing = processing.then(() => handleLine(line)).catch((e) => {
    console.log(chalk.red(`line handler error: ${e.message}`));
  });
});

rl.on("close", async () => {
  try {
    await processing;
  } catch {}
  process.exit(0);
});
