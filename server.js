import http from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyActiveRelayProfile,
  applyCustomProvider,
  deleteRelayProfile,
  readProfileState,
  readSwitchSettings,
  readStatus,
  saveRelayProfile,
  saveSwitchSettings,
  selectRelayProfile,
} from "./src/config.js";
import { detectCodexApp, injectPluginUnlock, launchCodex, readServiceTierMode, setServiceTierMode } from "./src/cdp.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(dirname, "public");
const port = Number(process.env.PORT || 38383);

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
    if (url.pathname === "/api/status" && request.method === "GET") {
      return sendJson(response, 200, {
        ok: true,
        status: await statusPayload(),
      });
    }
    if (url.pathname === "/api/apply" && request.method === "POST") {
      const body = await readJsonBody(request);
      const status = body.profileId
        ? (await selectRelayProfile(body.profileId)).status
        : await applyCustomProvider({
            baseUrl: body.baseUrl,
            apiKey: body.apiKey,
          });
      return sendJson(response, 200, {
        ok: true,
        message: status.authenticated
          ? '已写入 model_provider = "custom"，官方登录态保持不变。'
          : '已写入 model_provider = "custom"，但还没有检测到官方 ChatGPT 登录态。',
        status: await statusPayload(status),
      });
    }
    if (url.pathname === "/api/profiles" && request.method === "GET") {
      return sendJson(response, 200, {
        ok: true,
        profiles: await readProfileState(),
        status: await statusPayload(),
      });
    }
    if (url.pathname === "/api/profiles/save" && request.method === "POST") {
      const body = await readJsonBody(request);
      const profiles = await saveRelayProfile(body.profile || body);
      return sendJson(response, 200, {
        ok: true,
        message: "中转配置已保存。",
        profiles,
        status: await statusPayload(),
      });
    }
    if (url.pathname === "/api/profiles/delete" && request.method === "POST") {
      const body = await readJsonBody(request);
      const profiles = await deleteRelayProfile(body.id);
      return sendJson(response, 200, {
        ok: true,
        message: "中转配置已删除。",
        profiles,
        status: await statusPayload(),
      });
    }
    if (url.pathname === "/api/profiles/select" && request.method === "POST") {
      const body = await readJsonBody(request);
      const result = await selectRelayProfile(body.id, { apply: body.apply !== false });
      const { status, ...profiles } = result;
      return sendJson(response, 200, {
        ok: true,
        message: "已切换当前 Codex 中转配置。",
        profiles,
        status: await statusPayload(status || undefined),
      });
    }
    if (url.pathname === "/api/test-profile" && request.method === "POST") {
      const body = await readJsonBody(request);
      const result = await testProfile(body.profile || body);
      return sendJson(response, 200, {
        ok: true,
        message: result.message,
        test: result,
        status: await statusPayload(),
      });
    }
    if (url.pathname === "/api/service-tier" && request.method === "GET") {
      const debugPort = Number(url.searchParams.get("debugPort") || 9229);
      return sendJson(response, 200, {
        ok: true,
        settings: await readSwitchSettings(),
        page: await safeReadServiceTierMode(debugPort),
        status: await statusPayload(),
      });
    }
    if (url.pathname === "/api/service-tier" && request.method === "POST") {
      const body = await readJsonBody(request);
      const settings = await saveSwitchSettings({ serviceTierMode: body.mode });
      const page = body.apply === false ? null : await safeApplyServiceTierMode({ debugPort: Number(body.debugPort || 9229), mode: settings.serviceTierMode });
      return sendJson(response, 200, {
        ok: true,
        message: page?.ok
          ? `服务模式已切换为 ${serviceTierLabel(settings.serviceTierMode)}。`
          : `服务模式已保存为 ${serviceTierLabel(settings.serviceTierMode)}，下次注入后生效。`,
        settings,
        page,
        status: await statusPayload(),
      });
    }
    if (url.pathname === "/api/inject" && request.method === "POST") {
      const body = await readJsonBody(request);
      const debugPort = Number(body.debugPort || 9229);
      const injection = await injectPluginUnlock({ debugPort });
      const serviceTier = await applyStoredServiceTierMode(debugPort);
      return sendJson(response, 200, {
        ok: true,
        message: "插件解锁脚本已注入当前 Codex 窗口，服务模式已同步。",
        injection,
        serviceTier,
        status: await statusPayload(),
      });
    }
    if (url.pathname === "/api/launch" && request.method === "POST") {
      const body = await readJsonBody(request);
      const debugPort = Number(body.debugPort || 9229);
      let applied = null;
      if (String(body.baseUrl || "").trim() && String(body.apiKey || "").trim()) {
        applied = await applyCustomProvider({
          baseUrl: body.baseUrl,
          apiKey: body.apiKey,
        });
      } else if (body.applyActive !== false) {
        applied = await applyActiveRelayProfile();
      }
      const launch = await launchCodex({
        appPath: body.codexAppPath,
        debugPort,
      });
      const injection = await injectPluginUnlock({ debugPort });
      const serviceTier = await applyStoredServiceTierMode(debugPort);
      return sendJson(response, 200, {
        ok: true,
        message: "Codex 已用 CDP 启动，并完成插件解锁和服务模式同步。",
        launch,
        injection,
        serviceTier,
        applied,
        status: await statusPayload(applied || undefined),
      });
    }
    if (url.pathname.startsWith("/api/")) {
      return sendJson(response, 404, { ok: false, error: "Not found" });
    }
    return serveStatic(url.pathname, response);
  } catch (error) {
    return sendJson(response, 500, {
      ok: false,
      error: error?.message || String(error),
      status: await safeStatusPayload(),
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Codex Switch: http://127.0.0.1:${port}`);
});

async function statusPayload(existingStatus = null) {
  const status = existingStatus || (await readStatus());
  const codexApp = await detectCodexApp();
  return {
    ...status,
    codexApp,
    nodeWebSocket: typeof WebSocket !== "undefined",
  };
}

async function safeStatusPayload() {
  try {
    return await statusPayload();
  } catch {
    return null;
  }
}

async function applyStoredServiceTierMode(debugPort) {
  const settings = await readSwitchSettings();
  return safeApplyServiceTierMode({ debugPort, mode: settings.serviceTierMode });
}

async function safeApplyServiceTierMode({ debugPort, mode }) {
  try {
    return await setServiceTierMode({ debugPort, mode });
  } catch (error) {
    return {
      ok: false,
      mode,
      error: error?.message || String(error),
    };
  }
}

async function safeReadServiceTierMode(debugPort) {
  try {
    return await readServiceTierMode({ debugPort });
  } catch (error) {
    return {
      ok: false,
      mode: "unknown",
      error: error?.message || String(error),
    };
  }
}

function serviceTierLabel(mode) {
  if (mode === "fast") return "Fast";
  if (mode === "standard") return "Standard";
  return "继承";
}

async function serveStatic(urlPath, response) {
  const normalizedPath = urlPath === "/" ? "/index.html" : urlPath;
  const filePath = path.normalize(path.join(publicDir, normalizedPath));
  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  try {
    const contents = await fs.readFile(filePath);
    response.writeHead(200, {
      "content-type": contentType(filePath),
      "cache-control": "no-store",
    });
    response.end(contents);
  } catch (error) {
    if (error?.code === "ENOENT") {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    throw error;
  }
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text.trim() ? JSON.parse(text) : {};
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(payload, null, 2));
}

function contentType(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}

async function testProfile(profile) {
  const baseUrl = String(profile?.baseUrl || "").trim().replace(/\/+$/, "");
  const apiKey = String(profile?.apiKey || "").trim();
  if (!baseUrl) throw new Error("Base URL 不能为空");
  if (!apiKey) throw new Error("API Key 不能为空");
  const endpoint = `${baseUrl}/responses`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: String(profile?.testModel || "gpt-4.1-mini"),
        input: "hi",
        max_output_tokens: 8,
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    return {
      endpoint,
      httpStatus: response.status,
      ok: response.ok,
      message: response.ok ? "测试连接成功。" : `测试连接返回 HTTP ${response.status}。`,
      responsePreview: text.slice(0, 360),
    };
  } finally {
    clearTimeout(timer);
  }
}
