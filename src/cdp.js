import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const INJECT_PATH = path.join(dirname, "plugin-unlock-inject.js");

export async function detectCodexApp(userPath = "") {
  const candidates = codexAppCandidates(userPath);

  for (const candidate of candidates) {
    const expanded = expandHome(candidate);
    try {
      const stat = await fs.stat(expanded);
      if (process.platform === "darwin" && stat.isDirectory()) return expanded;
      if (process.platform === "win32") {
        if (stat.isFile()) return expanded;
        if (stat.isDirectory()) {
          const executable = await firstExistingPath(windowsExecutableNames().map((name) => path.join(expanded, name)));
          if (executable) return executable;
        }
      }
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

export async function launchCodex({ appPath = "", debugPort = 9229 } = {}) {
  const resolved = await detectCodexApp(appPath);
  if (!resolved) {
    throw new Error(process.platform === "win32" ? "没有找到 Codex.exe，请在界面里填写 Codex.exe 路径" : "没有找到 Codex.app，请在界面里填写 Codex.app 路径");
  }
  if (process.platform === "darwin") {
    const args = [
      "-na",
      resolved,
      "--args",
      `--remote-debugging-port=${debugPort}`,
      `--remote-allow-origins=http://127.0.0.1:${debugPort}`,
    ];
    const child = spawn("open", args, { detached: true, stdio: "ignore" });
    child.unref();
    return { appPath: resolved, debugPort, args: ["open", ...args] };
  }

  if (process.platform === "win32") {
    const args = [
      `--remote-debugging-port=${debugPort}`,
      `--remote-allow-origins=http://127.0.0.1:${debugPort}`,
    ];
    const child = spawn(resolved, args, { detached: true, stdio: "ignore", windowsHide: false });
    child.unref();
    return { appPath: resolved, debugPort, args: [resolved, ...args] };
  }

  throw new Error("当前小应用只实现了 macOS 和 Windows 的 Codex 启动");
}

function codexAppCandidates(userPath = "") {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    const programFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    return [
      userPath,
      process.env.CODEX_APP_PATH,
      path.join(localAppData, "Programs", "Codex", "Codex.exe"),
      path.join(localAppData, "Programs", "OpenAI Codex", "OpenAI Codex.exe"),
      path.join(localAppData, "Programs", "OpenAI Codex", "Codex.exe"),
      path.join(localAppData, "Codex", "Codex.exe"),
      path.join(programFiles, "Codex", "Codex.exe"),
      path.join(programFiles, "OpenAI Codex", "OpenAI Codex.exe"),
      path.join(programFiles, "OpenAI Codex", "Codex.exe"),
      path.join(programFilesX86, "Codex", "Codex.exe"),
      path.join(programFilesX86, "OpenAI Codex", "OpenAI Codex.exe"),
      path.join(programFilesX86, "OpenAI Codex", "Codex.exe"),
    ].filter(Boolean);
  }

  return [
    userPath,
    process.env.CODEX_APP_PATH,
    "/Applications/OpenAI Codex.app",
    "/Applications/Codex.app",
    path.join(os.homedir(), "Applications", "OpenAI Codex.app"),
    path.join(os.homedir(), "Applications", "Codex.app"),
  ].filter(Boolean);
}

function windowsExecutableNames() {
  return ["Codex.exe", "OpenAI Codex.exe"];
}

async function firstExistingPath(candidates) {
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

export async function injectPluginUnlock({ debugPort = 9229 } = {}) {
  if (typeof WebSocket === "undefined") {
    throw new Error("当前 Node 运行时没有 WebSocket；请使用 Node 22 或更新版本");
  }
  const target = await waitForCdpTarget(debugPort, 18000);
  const source = await fs.readFile(INJECT_PATH, "utf8");
  const results = await runCdpCommands(target.webSocketDebuggerUrl, [
    ["Runtime.enable", {}],
    ["Page.enable", {}],
    ["Page.addScriptToEvaluateOnNewDocument", { source }],
    ["Runtime.evaluate", { expression: source, awaitPromise: false, returnByValue: true }],
  ]);
  return {
    debugPort,
    target: {
      title: target.title,
      url: target.url,
    },
    injected: true,
    result: results.at(-1)?.result?.result?.value || "ok",
  };
}

export async function waitForCdpTarget(debugPort, timeoutMs = 18000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const targets = await listTargets(debugPort);
      return pickPageTarget(targets);
    } catch (error) {
      lastError = error;
      await delay(500);
    }
  }
  throw new Error(`没有在 127.0.0.1:${debugPort} 找到可注入的 Codex 页面：${lastError?.message || "timeout"}`);
}

export async function listTargets(debugPort) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json`, {
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`CDP HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export function pickPageTarget(targets) {
  const pages = targets.filter((target) => target.type === "page" && target.webSocketDebuggerUrl);
  const codex = pages.find((target) => `${target.title || ""} ${target.url || ""}`.toLowerCase().includes("codex"));
  const target = codex || pages[0];
  if (!target) throw new Error("No injectable Codex page target found");
  return target;
}

async function runCdpCommands(webSocketDebuggerUrl, commands) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 1;

  socket.addEventListener("message", async (event) => {
    const text = await messageDataToText(event.data);
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject, timer } = pending.get(message.id);
    clearTimeout(timer);
    pending.delete(message.id);
    if (message.error) {
      reject(new Error(message.error.message || JSON.stringify(message.error)));
    } else {
      resolve(message);
    }
  });

  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", () => reject(new Error("CDP WebSocket 连接失败")), { once: true });
  });

  try {
    const results = [];
    for (const [method, params] of commands) {
      const id = nextId;
      nextId += 1;
      results.push(await sendCdp(socket, pending, id, method, params));
    }
    return results;
  } finally {
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(new Error("CDP WebSocket 已关闭"));
    }
    pending.clear();
    socket.close();
  }
}

function sendCdp(socket, pending, id, method, params) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} 超时`));
    }, 5000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function messageDataToText(data) {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
  if (data && typeof data.arrayBuffer === "function") {
    return Buffer.from(await data.arrayBuffer()).toString("utf8");
  }
  return String(data);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function expandHome(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}
