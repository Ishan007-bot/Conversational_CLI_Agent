import "dotenv/config";
import chalk from "chalk";
import { runAgent } from "./agent.js";

console.log(chalk.bold.cyan("\nScaler Clone CLI Agent"));
console.log(chalk.gray("Phase 1 entry — full conversational REPL arrives in Phase 2.\n"));

const userMessage =
  process.argv.slice(2).join(" ").trim() ||
  "Say hello in one sentence as the Scaler Clone CLI Agent. No tools needed.";

await runAgent(userMessage);
