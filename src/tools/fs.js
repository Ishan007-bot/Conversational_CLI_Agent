import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";

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

function safeResolve(rawPath, { allowOutsideWorkspace = false } = {}) {
  if (typeof rawPath !== "string" || !rawPath.trim()) {
    throw new Error("path must be a non-empty string");
  }
  const normalized = rawPath.replace(/\\/g, "/");
  const absolute = path.resolve(WORKSPACE_ROOT, normalized);
  if (!allowOutsideWorkspace) {
    const rel = path.relative(WORKSPACE_ROOT, absolute);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(
        `path escapes the workspace root (${WORKSPACE_ROOT}): ${rawPath}`
      );
    }
  }
  return absolute;
}

function rel(absolute) {
  const r = path.relative(WORKSPACE_ROOT, absolute);
  return r === "" ? "." : r.replace(/\\/g, "/");
}

export async function writeFile(args) {
  const filePath = resolveArg(args, "path");
  const content = resolveArg(args, "content");
  if (!filePath || typeof content !== "string") {
    throw new Error('writeFile requires {"path": string, "content": string}');
  }
  const absolute = safeResolve(filePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content, "utf-8");
  return `File written: ${rel(absolute)} (${content.length} bytes)`;
}

export async function writeFiles(args) {
  let files = resolveArg(args, "files");
  if (!Array.isArray(files)) {
    if (args && typeof args === "object" && Array.isArray(args)) files = args;
  }
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('writeFiles requires {"files": [{"path": ..., "content": ...}, ...]}');
  }
  const written = [];
  for (const entry of files) {
    const filePath = entry?.path;
    const content = entry?.content;
    if (!filePath || typeof content !== "string") {
      throw new Error(`writeFiles entry malformed: ${JSON.stringify(entry).slice(0, 80)}`);
    }
    const absolute = safeResolve(filePath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content, "utf-8");
    written.push(`${rel(absolute)} (${content.length}b)`);
  }
  return `Wrote ${written.length} files: ${written.join(", ")}`;
}

export async function readFile(args) {
  const filePath = resolveArg(args, "path");
  if (!filePath) throw new Error('readFile requires {"path": string}');
  const absolute = safeResolve(filePath);
  return await fs.readFile(absolute, "utf-8");
}

export async function listFiles(args) {
  const dir =
    resolveArg(args, "dir") ||
    resolveArg(args, "path") ||
    (typeof args === "string" ? args : ".");
  const absolute = safeResolve(dir);
  const entries = await fs.readdir(absolute, { withFileTypes: true });
  if (entries.length === 0) return `(empty directory: ${rel(absolute)})`;
  return entries
    .map((e) => `${e.isDirectory() ? "[DIR] " : "      "}${e.name}`)
    .join("\n");
}

export async function createFolder(args) {
  const folderPath =
    resolveArg(args, "path") || (typeof args === "string" ? args : null);
  if (!folderPath) throw new Error('createFolder requires {"path": string}');
  const absolute = safeResolve(folderPath);
  await fs.mkdir(absolute, { recursive: true });
  return `Folder created: ${rel(absolute)}`;
}

export async function pathExists(args) {
  const target =
    resolveArg(args, "path") || (typeof args === "string" ? args : null);
  if (!target) throw new Error('pathExists requires {"path": string}');
  const absolute = safeResolve(target);
  try {
    const stat = await fs.stat(absolute);
    return JSON.stringify({
      exists: true,
      type: stat.isDirectory() ? "directory" : "file",
      size: stat.size,
      path: rel(absolute),
    });
  } catch (e) {
    if (e.code === "ENOENT") {
      return JSON.stringify({ exists: false, path: rel(absolute) });
    }
    throw e;
  }
}

export function openInBrowser(args) {
  const filePath =
    resolveArg(args, "path") || (typeof args === "string" ? args : null);
  if (!filePath)
    return Promise.reject(new Error('openInBrowser requires {"path": string}'));
  let absolute;
  try {
    absolute = safeResolve(filePath);
  } catch (e) {
    return Promise.reject(e);
  }
  let cmd;
  if (process.platform === "win32") {
    cmd = `start "" "${absolute}"`;
  } else if (process.platform === "darwin") {
    cmd = `open "${absolute}"`;
  } else {
    cmd = `xdg-open "${absolute}"`;
  }
  return new Promise((resolve, reject) => {
    exec(cmd, (error) => {
      if (error)
        return reject(new Error(`openInBrowser failed: ${error.message}`));
      resolve(`Opened in browser: ${rel(absolute)}`);
    });
  });
}

export const __test_only = { WORKSPACE_ROOT, safeResolve };
