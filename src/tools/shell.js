import { exec } from "child_process";

export function executeCommand(cmd = "") {
  return new Promise((resolve, reject) => {
    exec(cmd, { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        return reject(new Error(`exec failed: ${error.message}${stderr ? ` | stderr: ${stderr}` : ""}`));
      }
      const output = (stdout || "").trim() || (stderr || "").trim() || `Executed: ${cmd}`;
      resolve(output);
    });
  });
}
