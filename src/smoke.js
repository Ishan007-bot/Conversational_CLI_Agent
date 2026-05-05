import "dotenv/config";
import chalk from "chalk";
import { runAgent } from "./agent.js";

console.log(chalk.bold("\n=== Phase 1 Smoke Test ===\n"));

const prompts = [
  "Reply with a one-sentence greeting introducing yourself as the Scaler Clone CLI Agent. No tools needed.",
  "Use the executeCommand tool to run 'node --version' and tell me which Node.js version is installed.",
];

let history = [];
for (const p of prompts) {
  console.log(chalk.bold.white(`\n>> USER: ${p}`));
  const res = await runAgent(p, history);
  history = res.history;
  if (!res.output) {
    console.log(chalk.red("\n[FAIL] no OUTPUT returned, stopping smoke test"));
    process.exit(1);
  }
}

console.log(chalk.bold.green("\n=== Smoke test passed ===\n"));
