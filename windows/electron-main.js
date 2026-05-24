import { app, BrowserWindow, dialog, Menu, nativeImage, Tray } from "electron";
import { spawn } from "node:child_process";
import path from "node:path";

const APP_NAME = "Codex Switch";
const PORT = String(process.env.PORT || "38383");
const DEBUG_PORT = 9229;

let tray = null;
let panel = null;
let serverProcess = null;
let launchInProgress = false;
let quitting = false;

const lock = app.requestSingleInstanceLock();
if (!lock) {
  app.quit();
} else {
  app.setAppUserModelId("local.codex-switch");
  app.on("second-instance", () => {
    openPanel().catch(showError);
  });
  app.on("before-quit", () => {
    quitting = true;
    stopServer();
  });
  app.on("window-all-closed", () => {});
  app.whenReady().then(() => {
    installTray();
  });
}

function installTray() {
  const image = nativeImage.createFromPath(resourcePath("windows", "tray.png")).resize({ width: 16, height: 16 });
  tray = new Tray(image);
  tray.setToolTip(APP_NAME);
  tray.on("click", () => {
    openPanel().catch(showError);
  });
  updateTrayMenu();
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "打开面板",
        click: () => {
          openPanel().catch(showError);
        },
      },
      {
        label: "启动",
        enabled: !launchInProgress,
        click: () => {
          launchCodexFromTray().catch(showError);
        },
      },
      {
        label: "退出",
        click: () => {
          quitting = true;
          stopServer();
          app.quit();
        },
      },
    ]),
  );
}

async function openPanel() {
  await startOrReuseServer();
  if (!panel) createPanel();
  await panel.loadURL(baseUrl());
  panel.show();
  panel.focus();
}

function createPanel() {
  panel = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 840,
    minHeight: 620,
    show: false,
    title: APP_NAME,
    icon: resourcePath("windows", "CodexSwitch.ico"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  panel.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    panel.hide();
    stopServer();
  });
}

async function launchCodexFromTray() {
  if (launchInProgress) return;
  launchInProgress = true;
  updateTrayMenu();
  try {
    await startOrReuseServer();
    await postJson("/api/launch", { debugPort: DEBUG_PORT });
  } finally {
    launchInProgress = false;
    updateTrayMenu();
    if (!panel?.isVisible()) {
      stopServer();
    }
  }
}

async function startOrReuseServer() {
  if (await probeServer()) return;
  if (!serverProcess) startServer();
  await waitForServer(50);
}

function startServer() {
  const serverScript = resourcePath("server.js");
  serverProcess = spawn(process.execPath, [serverScript], {
    cwd: app.getAppPath(),
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      PORT,
    },
    stdio: "ignore",
    windowsHide: true,
  });
  serverProcess.on("exit", () => {
    serverProcess = null;
  });
}

function stopServer() {
  if (!serverProcess) return;
  const child = serverProcess;
  serverProcess = null;
  if (!child.killed) child.kill();
}

async function waitForServer(attemptsLeft) {
  for (let attempt = 0; attempt < attemptsLeft; attempt += 1) {
    if (await probeServer()) return;
    await delay(250);
  }
  throw new Error(`本地服务没有在 127.0.0.1:${PORT} 就绪。`);
}

async function probeServer() {
  try {
    const response = await fetchWithTimeout(`${baseUrl()}/api/status`, { timeoutMs: 1200 });
    return response.ok;
  } catch {
    return false;
  }
}

async function postJson(pathname, body) {
  const response = await fetchWithTimeout(`${baseUrl()}${pathname}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    timeoutMs: 30000,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(extractErrorMessage(text) || `HTTP ${response.status}`);
  }
  return text ? JSON.parse(text) : null;
}

async function fetchWithTimeout(url, options = {}) {
  const { timeoutMs = 5000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...fetchOptions, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function extractErrorMessage(text) {
  try {
    const json = JSON.parse(text);
    return json.error || json.message || text;
  } catch {
    return text;
  }
}

function showError(error) {
  dialog.showErrorBox(APP_NAME, error?.message || String(error));
}

function baseUrl() {
  return `http://127.0.0.1:${PORT}`;
}

function resourcePath(...parts) {
  return path.join(app.getAppPath(), ...parts);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
