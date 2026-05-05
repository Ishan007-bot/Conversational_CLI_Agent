// Offline structural sanity check — no network, no API key required.
import chalk from "chalk";
import {
  writeFile,
  writeFiles,
  readFile,
  listFiles,
  createFolder,
  openInBrowser,
  pathExists,
} from "./tools/fs.js";
import { executeCommand } from "./tools/shell.js";
import {
  fetchWebpage,
  getTheWeatherOfCity,
  getGithubDetailsAboutUser,
} from "./tools/web.js";
import { SYSTEM_PROMPT } from "./prompts/system.js";

let failed = 0;
const ok = (m) => console.log(chalk.green("PASS"), m);
const fail = (m, e) => {
  failed++;
  console.log(chalk.red("FAIL"), m, e?.message || e || "");
};

console.log(chalk.bold("\n=== Phase 1 self-check ===\n"));

if (typeof SYSTEM_PROMPT === "string" && SYSTEM_PROMPT.length > 200)
  ok("system prompt loaded");
else fail("system prompt missing or too short");

const tools = {
  writeFile,
  writeFiles,
  readFile,
  listFiles,
  createFolder,
  pathExists,
  openInBrowser,
  executeCommand,
  fetchWebpage,
  getTheWeatherOfCity,
  getGithubDetailsAboutUser,
};
for (const [name, fn] of Object.entries(tools)) {
  if (typeof fn === "function") ok(`tool ${name} is a function`);
  else fail(`tool ${name} is not a function`);
}

try {
  await createFolder({ path: "./output/_selfcheck" });
  await writeFile({ path: "./output/_selfcheck/hello.txt", content: "hi" });
  const back = await readFile({ path: "./output/_selfcheck/hello.txt" });
  if (back === "hi") ok("writeFile + readFile roundtrip");
  else fail("readFile content mismatch", back);
  const listing = await listFiles({ dir: "./output/_selfcheck" });
  if (listing.includes("hello.txt")) ok("listFiles shows new file");
  else fail("listFiles missing new file", listing);
} catch (e) {
  fail("fs roundtrip threw", e);
}

try {
  const exists = JSON.parse(await pathExists({ path: "./output/_selfcheck/hello.txt" }));
  if (exists.exists && exists.type === "file") ok("pathExists detects existing file");
  else fail("pathExists wrong result for existing file", exists);
  const missing = JSON.parse(await pathExists({ path: "./output/_selfcheck/nope.txt" }));
  if (missing.exists === false) ok("pathExists detects missing file");
  else fail("pathExists wrong result for missing file", missing);
} catch (e) {
  fail("pathExists threw", e);
}

try {
  await writeFiles({
    files: [
      { path: "./output/_selfcheck/a.txt", content: "AAA" },
      { path: "./output/_selfcheck/b.txt", content: "BBB" },
    ],
  });
  const a = await readFile({ path: "./output/_selfcheck/a.txt" });
  const b = await readFile({ path: "./output/_selfcheck/b.txt" });
  if (a === "AAA" && b === "BBB") ok("writeFiles batch wrote both files");
  else fail("writeFiles content mismatch", `a=${a} b=${b}`);
} catch (e) {
  fail("writeFiles threw", e);
}

try {
  await writeFile({ path: "../../etc/evil.txt", content: "x" });
  fail("workspace escape was NOT rejected (security regression)");
} catch (e) {
  if (/escapes the workspace/.test(e.message)) ok("workspace escape correctly rejected");
  else fail("workspace escape threw wrong error", e);
}

try {
  const out = await executeCommand("node --version");
  if (/^v\d+/.test(out)) ok(`executeCommand returned ${out}`);
  else fail("executeCommand unexpected output", out);
} catch (e) {
  fail("executeCommand threw", e);
}

try {
  const html = await fetchWebpage("https://example.com");
  if (html.toLowerCase().includes("example domain"))
    ok(`fetchWebpage works (${html.length} bytes)`);
  else fail("fetchWebpage content unexpected", html.slice(0, 120));
} catch (e) {
  fail("fetchWebpage threw", e);
}

console.log("");
if (failed === 0) {
  console.log(chalk.bold.green(`All checks passed. Ready for npm run smoke once .env has GROQ_API_KEY (or OPENAI_API_KEY).\n`));
  process.exit(0);
} else {
  console.log(chalk.bold.red(`${failed} check(s) failed.\n`));
  process.exit(1);
}
