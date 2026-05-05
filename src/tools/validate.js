import fs from "fs/promises";
import path from "path";

const WORKSPACE_ROOT = path.resolve(
  process.env.AGENT_WORKSPACE_ROOT || process.cwd()
);

function resolveArg(arg, key) {
  if (arg && typeof arg === "object") return arg[key];
  if (typeof arg === "string") {
    try {
      const parsed = JSON.parse(arg);
      if (parsed && typeof parsed === "object") return parsed[key];
    } catch {}
    return arg;
  }
  return undefined;
}

function safeResolve(rawPath) {
  const normalized = String(rawPath).replace(/\\/g, "/");
  const absolute = path.resolve(WORKSPACE_ROOT, normalized);
  const rel = path.relative(WORKSPACE_ROOT, absolute);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`path escapes the workspace root: ${rawPath}`);
  }
  return absolute;
}

async function tryRead(absolutePath) {
  try {
    return await fs.readFile(absolutePath, "utf-8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

function extractClassesFromHtml(html) {
  const set = new Set();
  const re = /class\s*=\s*"([^"]+)"/gi;
  let m;
  while ((m = re.exec(html))) {
    m[1].split(/\s+/).forEach((c) => c && set.add(c));
  }
  return set;
}

function extractIdsFromHtml(html) {
  const set = new Set();
  const re = /id\s*=\s*"([^"]+)"/gi;
  let m;
  while ((m = re.exec(html))) set.add(m[1]);
  return set;
}

function extractClassSelectorsFromCss(css) {
  const set = new Set();
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = /\.([A-Za-z][\w-]*)/g;
  let m;
  while ((m = re.exec(stripped))) set.add(m[1]);
  return set;
}

function extractJsRefsFromScript(js) {
  const ids = new Set();
  const classes = new Set();
  const stripped = js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  // getElementById('foo') / "foo"
  const idRe = /getElementById\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = idRe.exec(stripped))) ids.add(m[1]);
  // querySelector / querySelectorAll with #foo or .foo
  const qsRe = /querySelector(?:All)?\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = qsRe.exec(stripped))) {
    const sel = m[1];
    [...sel.matchAll(/#([A-Za-z][\w-]*)/g)].forEach((x) => ids.add(x[1]));
    [...sel.matchAll(/\.([A-Za-z][\w-]*)/g)].forEach((x) => classes.add(x[1]));
  }
  // closest('.foo'), matches('.foo')
  const closestRe = /\.(?:closest|matches)\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = closestRe.exec(stripped))) {
    const sel = m[1];
    [...sel.matchAll(/#([A-Za-z][\w-]*)/g)].forEach((x) => ids.add(x[1]));
    [...sel.matchAll(/\.([A-Za-z][\w-]*)/g)].forEach((x) => classes.add(x[1]));
  }
  return { ids, classes };
}

export async function validateGeneratedFiles(args) {
  const dir =
    resolveArg(args, "dir") ||
    resolveArg(args, "path") ||
    (typeof args === "string" ? args : "./output/scaler-clone");
  const absDir = safeResolve(dir);

  const htmlPath = path.join(absDir, "index.html");
  const cssPath = path.join(absDir, "style.css");
  const cssAltPath = path.join(absDir, "styles.css");
  const jsPath = path.join(absDir, "script.js");

  const problems = [];
  const warnings = [];

  const html = await tryRead(htmlPath);
  let css = await tryRead(cssPath);
  let cssFilename = "style.css";
  if (css == null) {
    css = await tryRead(cssAltPath);
    if (css != null) cssFilename = "styles.css";
  }
  const js = await tryRead(jsPath);

  if (html == null) problems.push(`Missing file: ${path.relative(WORKSPACE_ROOT, htmlPath).replace(/\\/g, "/")}`);
  if (css == null) problems.push(`Missing file: ${path.relative(WORKSPACE_ROOT, cssPath).replace(/\\/g, "/")} (or styles.css)`);
  if (js == null) problems.push(`Missing file: ${path.relative(WORKSPACE_ROOT, jsPath).replace(/\\/g, "/")}`);

  if (html != null) {
    const lower = html.toLowerCase();

    if (!new RegExp(`href\\s*=\\s*["']\\.?\\/?${cssFilename}["']`, "i").test(html))
      problems.push(`index.html does not <link rel="stylesheet" href="${cssFilename}">`);
    if (!/<script[^>]+src\s*=\s*["']\.?\/?script\.js["']/i.test(html))
      problems.push("index.html does not <script src=\"script.js\">");

    if (!/<header[\s>]/i.test(lower)) problems.push("Missing <header> semantic tag");
    if (!/<nav[\s>]/i.test(lower)) warnings.push("Missing <nav> tag inside header");
    if (!/<main[\s>]/i.test(lower) && !/<section[\s>]/i.test(lower))
      problems.push("Missing <main> and <section> tags (need at least one)");
    if (!/<footer[\s>]/i.test(lower)) problems.push("Missing <footer> semantic tag");

    if (!/<h1[\s>]/i.test(lower)) problems.push("Hero is missing an <h1>");

    const heroMatch = lower.match(/<section[^>]*class=["'][^"']*hero[^"']*["'][\s\S]*?<\/section>/i);
    if (!heroMatch) warnings.push("No <section class=\"hero\"> found — hero section may be unstructured");

    if (!/<button[\s>]/i.test(lower) && !/class=["'][^"']*(btn|cta|primary-button|apply)/i.test(html))
      problems.push("No <button> or CTA element found in the page");

    if (!/aria-label\s*=/i.test(html)) warnings.push("No aria-label attributes found — icon-only buttons should have one");
    if (/lorem\s+ipsum/i.test(html)) problems.push("Lorem ipsum placeholder text in HTML — replace with real copy");
  }

  if (css != null) {
    if (!/@media[^{]*\b(max|min)-width/i.test(css))
      problems.push(`${cssFilename} has no @media (min-width|max-width) responsive query`);
    if (!/:root\s*\{/i.test(css)) warnings.push(`${cssFilename} does not declare CSS custom properties on :root`);
    if (!/clamp\s*\(/i.test(css)) warnings.push(`${cssFilename} does not use clamp() for fluid typography`);
  }

  if (html != null && css != null) {
    const htmlClasses = extractClassesFromHtml(html);
    const cssClasses = extractClassSelectorsFromCss(css);
    const orphanCss = [...cssClasses].filter((c) => !htmlClasses.has(c));
    const unstyledHtml = [...htmlClasses].filter((c) => !cssClasses.has(c));
    if (orphanCss.length > 0)
      warnings.push(`CSS selectors with no matching HTML class (${orphanCss.length}): ${orphanCss.slice(0, 8).join(", ")}${orphanCss.length > 8 ? ", ..." : ""}`);
    if (unstyledHtml.length > 0)
      warnings.push(`HTML classes with no CSS rule (${unstyledHtml.length}): ${unstyledHtml.slice(0, 8).join(", ")}${unstyledHtml.length > 8 ? ", ..." : ""}`);
  }

  if (html != null && js != null) {
    const ids = extractIdsFromHtml(html);
    const classes = extractClassesFromHtml(html);
    const refs = extractJsRefsFromScript(js);
    const missingIds = [...refs.ids].filter((id) => !ids.has(id));
    const missingClasses = [...refs.classes].filter((c) => !classes.has(c));
    if (missingIds.length > 0)
      problems.push(`script.js references missing element IDs: ${missingIds.join(", ")}`);
    if (missingClasses.length > 0)
      warnings.push(`script.js references classes not in HTML: ${missingClasses.slice(0, 8).join(", ")}${missingClasses.length > 8 ? ", ..." : ""}`);
    if (!/addEventListener|onclick|on[a-z]+/.test(js))
      problems.push("script.js does not register any event listener — no real interaction");
  }

  const stats = {
    htmlBytes: html?.length ?? 0,
    cssBytes: css?.length ?? 0,
    jsBytes: js?.length ?? 0,
    problems: problems.length,
    warnings: warnings.length,
  };

  return JSON.stringify({ ok: problems.length === 0, problems, warnings, stats }, null, 2);
}
