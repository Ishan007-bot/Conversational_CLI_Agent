import fs from "fs/promises";
import path from "path";
import { exec } from "child_process";

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

export async function writeFile(args) {
  const filePath = resolveArg(args, "path");
  const content = resolveArg(args, "content");
  if (!filePath || typeof content !== "string") {
    throw new Error('writeFile requires {"path": string, "content": string}');
  }
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, content, "utf-8");
  return `File written: ${filePath} (${content.length} bytes)`;
}

export async function readFile(args) {
  const filePath = resolveArg(args, "path");
  if (!filePath) throw new Error('readFile requires {"path": string}');
  const content = await fs.readFile(filePath, "utf-8");
  return content;
}

export async function listFiles(args) {
  const dir = resolveArg(args, "dir") || resolveArg(args, "path") || (typeof args === "string" ? args : ".");
  const entries = await fs.readdir(dir, { withFileTypes: true });
  if (entries.length === 0) return `(empty directory: ${dir})`;
  return entries.map((e) => `${e.isDirectory() ? "[DIR] " : "      "}${e.name}`).join("\n");
}

export async function createFolder(args) {
  const folderPath = resolveArg(args, "path") || (typeof args === "string" ? args : null);
  if (!folderPath) throw new Error('createFolder requires {"path": string}');
  await fs.mkdir(folderPath, { recursive: true });
  return `Folder created: ${folderPath}`;
}

export function openInBrowser(args) {
  const filePath = resolveArg(args, "path") || (typeof args === "string" ? args : null);
  if (!filePath) return Promise.reject(new Error('openInBrowser requires {"path": string}'));
  const absolute = path.resolve(filePath);
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
      if (error) return reject(new Error(`openInBrowser failed: ${error.message}`));
      resolve(`Opened in browser: ${absolute}`);
    });
  });
}
