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
import { validateGeneratedFiles } from "./tools/validate.js";
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
  validateGeneratedFiles,
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
  // Bad sample: missing semantic tags, lorem ipsum, broken JS reference, no @media
  await writeFiles({
    files: [
      {
        path: "./output/_selfcheck_bad/index.html",
        content:
          '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><div class="thing">Lorem ipsum dolor sit amet</div><script src="script.js" defer></script></body></html>',
      },
      {
        path: "./output/_selfcheck_bad/style.css",
        content: ".thing { color: red; }",
      },
      {
        path: "./output/_selfcheck_bad/script.js",
        content: "document.getElementById('does-not-exist').addEventListener('click', () => {});",
      },
    ],
  });
  const badRes = JSON.parse(await validateGeneratedFiles({ dir: "./output/_selfcheck_bad" }));
  if (!badRes.ok && badRes.problems.length >= 4) ok(`validator caught ${badRes.problems.length} problems on bad sample`);
  else fail("validator missed problems on bad sample", JSON.stringify(badRes));
  if (badRes.problems.some((p) => /lorem ipsum/i.test(p))) ok("validator detects lorem ipsum");
  else fail("validator missed lorem ipsum");
  if (badRes.problems.some((p) => /does-not-exist/.test(p))) ok("validator detects JS ref to missing ID");
  else fail("validator missed JS missing-ID reference");

  // Good sample
  await writeFiles({
    files: [
      {
        path: "./output/_selfcheck_good/index.html",
        content:
          '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body>' +
          '<header><nav><a href="#">A</a></nav></header>' +
          '<main><section class="hero"><h1>Hello</h1><button class="btn-primary">Apply</button></section></main>' +
          '<footer><p>x</p></footer>' +
          '<script src="script.js" defer></script></body></html>',
      },
      {
        path: "./output/_selfcheck_good/style.css",
        content: ":root { --p: red; } .hero { padding: clamp(40px, 5vw, 96px); } @media (max-width: 768px) { .hero { padding: 16px; } }",
      },
      {
        path: "./output/_selfcheck_good/script.js",
        content: "document.addEventListener('DOMContentLoaded', () => { document.querySelector('.btn-primary')?.addEventListener('click', () => {}); });",
      },
    ],
  });
  const goodRes = JSON.parse(await validateGeneratedFiles({ dir: "./output/_selfcheck_good" }));
  if (goodRes.ok) ok("validator says good sample is OK");
  else fail("validator wrongly rejected good sample", JSON.stringify(goodRes.problems));
} catch (e) {
  fail("validateGeneratedFiles threw", e);
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
