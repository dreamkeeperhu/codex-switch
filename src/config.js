import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

export const CUSTOM_PROVIDER = "custom";
export const PROFILE_STORE_FILE = "codex-switch.json";
export const SETTINGS_STORE_FILE = "codex-switch-settings.json";
export const SERVICE_TIER_MODES = new Set(["inherit", "standard", "fast"]);

export function defaultCodexHome(env = process.env) {
  return expandHome(env.CODEX_HOME || "~/.codex");
}

export function expandHome(value) {
  if (!value) return value;
  if (value === "~") return os.homedir();
  if (value.startsWith("~/")) return path.join(os.homedir(), value.slice(2));
  return value;
}

export async function readStatus(options = {}) {
  const codexHome = options.codexHome || defaultCodexHome();
  const configPath = path.join(codexHome, "config.toml");
  const authPath = path.join(codexHome, "auth.json");
  const profileStorePath = path.join(codexHome, PROFILE_STORE_FILE);
  const settingsStorePath = path.join(codexHome, SETTINGS_STORE_FILE);
  const configContents = await readText(configPath);
  const authStatus = await readChatGptAuthStatus(authPath);
  const providerStatus = readCustomProviderStatus(configContents);
  const profileState = await readProfileState({ codexHome, providerStatus });
  const switchSettings = await readSwitchSettings({ codexHome });
  return {
    codexHome,
    configPath,
    authPath,
    profileStorePath,
    settingsStorePath,
    ...authStatus,
    ...providerStatus,
    profiles: profileState.profiles,
    activeProfileId: profileState.activeProfileId,
    activeProfile: profileState.activeProfile,
    switchSettings,
  };
}

export async function applyCustomProvider({ baseUrl, apiKey, codexHome = defaultCodexHome() }) {
  const cleanBaseUrl = String(baseUrl || "").trim();
  const cleanApiKey = String(apiKey || "").trim();
  if (!cleanBaseUrl) throw new Error("Base URL 不能为空");
  if (!cleanApiKey) throw new Error("API Key 不能为空");

  await fs.mkdir(codexHome, { recursive: true });
  const configPath = path.join(codexHome, "config.toml");
  const existing = await readText(configPath);
  const backupPath = await writeBackupIfNeeded(configPath, existing);
  const next = applyCustomProviderToContents(existing, cleanBaseUrl, cleanApiKey);
  await fs.writeFile(configPath, next, "utf8");
  const status = await readStatus({ codexHome });
  return {
    ...status,
    backupPath,
  };
}

export async function readProfileState({ codexHome = defaultCodexHome(), providerStatus = null } = {}) {
  const profileStorePath = path.join(codexHome, PROFILE_STORE_FILE);
  const raw = await readText(profileStorePath);
  const fallbackProfile = profileFromProviderStatus(providerStatus);
  let parsed = null;
  if (raw.trim()) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  const normalized = normalizeProfileStore(parsed, fallbackProfile);
  return {
    ...normalized,
    profileStorePath,
    activeProfile: normalized.profiles.find((profile) => profile.id === normalized.activeProfileId) || normalized.profiles[0] || null,
  };
}

export async function saveRelayProfile(profile, { codexHome = defaultCodexHome() } = {}) {
  const state = await readProfileState({ codexHome });
  const now = new Date().toISOString();
  const clean = cleanRelayProfile(profile, now);
  const existingIndex = state.profiles.findIndex((item) => item.id === clean.id);
  const profiles =
    existingIndex >= 0
      ? state.profiles.map((item, index) => (index === existingIndex ? { ...item, ...clean, createdAt: item.createdAt || clean.createdAt } : item))
      : [...state.profiles, clean];
  const activeProfileId = state.activeProfileId || clean.id;
  return writeProfileState({ codexHome, profiles, activeProfileId });
}

export async function deleteRelayProfile(id, { codexHome = defaultCodexHome() } = {}) {
  const state = await readProfileState({ codexHome });
  const cleanId = String(id || "").trim();
  if (!cleanId) throw new Error("请选择要删除的配置");
  if (state.profiles.length <= 1) throw new Error("至少保留一个中转配置");
  const profiles = state.profiles.filter((profile) => profile.id !== cleanId);
  if (profiles.length === state.profiles.length) throw new Error("没有找到这个中转配置");
  const activeProfileId = state.activeProfileId === cleanId ? profiles[0].id : state.activeProfileId;
  return writeProfileState({ codexHome, profiles, activeProfileId });
}

export async function selectRelayProfile(id, { codexHome = defaultCodexHome(), apply = true } = {}) {
  const state = await readProfileState({ codexHome });
  const profile = state.profiles.find((item) => item.id === String(id || "").trim());
  if (!profile) throw new Error("没有找到这个中转配置");
  const next = await writeProfileState({ codexHome, profiles: state.profiles, activeProfileId: profile.id });
  let status = null;
  if (apply) {
    status = await applyCustomProvider({
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey,
      codexHome,
    });
  }
  return {
    ...next,
    status,
  };
}

export async function applyActiveRelayProfile({ codexHome = defaultCodexHome() } = {}) {
  const currentStatus = await readStatus({ codexHome });
  const state = await readProfileState({ codexHome, providerStatus: currentStatus });
  const profile = state.activeProfile;
  if (!profile) throw new Error("还没有中转配置");
  return applyCustomProvider({
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    codexHome,
  });
}

export async function readSwitchSettings({ codexHome = defaultCodexHome() } = {}) {
  const settingsStorePath = path.join(codexHome, SETTINGS_STORE_FILE);
  const raw = await readText(settingsStorePath);
  let parsed = null;
  if (raw.trim()) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }
  return {
    settingsStorePath,
    serviceTierMode: normalizeServiceTierMode(parsed?.serviceTierMode),
  };
}

export async function saveSwitchSettings(settings, { codexHome = defaultCodexHome() } = {}) {
  const current = await readSwitchSettings({ codexHome });
  const next = {
    version: 1,
    serviceTierMode: normalizeServiceTierMode(settings?.serviceTierMode ?? current.serviceTierMode),
  };
  const settingsStorePath = path.join(codexHome, SETTINGS_STORE_FILE);
  await fs.mkdir(codexHome, { recursive: true });
  await fs.writeFile(settingsStorePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return readSwitchSettings({ codexHome });
}

export function normalizeServiceTierMode(mode) {
  const normalized = String(mode || "inherit").trim().toLowerCase();
  return SERVICE_TIER_MODES.has(normalized) ? normalized : "inherit";
}

export function applyCustomProviderToContents(contents, baseUrl, apiKey) {
  let updated = upsertRootStringKey(contents, "model_provider", CUSTOM_PROVIDER);
  updated = removeTable(updated, `model_providers.${CUSTOM_PROVIDER}`);
  const lines = updated.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const insertAt = firstNonProviderTableIndex(lines);
  const providerLines = [
    `[model_providers.${CUSTOM_PROVIDER}]`,
    `name = "${tomlEscape(CUSTOM_PROVIDER)}"`,
    'wire_api = "responses"',
    "requires_openai_auth = true",
    `base_url = "${tomlEscape(baseUrl)}"`,
    `experimental_bearer_token = "${tomlEscape(apiKey)}"`,
    "",
  ];
  lines.splice(insertAt, 0, ...providerLines);
  return ensureTrailingNewline(lines.join("\n"));
}

export function readCustomProviderStatus(contents) {
  const rootProvider = rootKeyString(contents, "model_provider");
  const provider = tableValues(contents, `model_providers.${CUSTOM_PROVIDER}`);
  const baseUrl = unquoteTomlString(provider?.base_url || "");
  const apiKey = unquoteTomlString(provider?.experimental_bearer_token || "");
  const wireApi = unquoteTomlString(provider?.wire_api || "");
  const hasBearerToken = Boolean(apiKey.trim());
  const requiresOpenaiAuth = String(provider?.requires_openai_auth || "").trim() === "true";
  return {
    provider: rootProvider || "",
    configured:
      rootProvider === CUSTOM_PROVIDER &&
      requiresOpenaiAuth &&
      hasBearerToken &&
      Boolean(baseUrl.trim()),
    baseUrl,
    apiKey,
    wireApi,
    requiresOpenaiAuth,
    hasBearerToken,
  };
}

export async function readChatGptAuthStatus(authPath) {
  const raw = await readText(authPath);
  if (!raw.trim()) {
    return { authenticated: false, accountLabel: null, authMessage: "未检测到 auth.json" };
  }
  let auth;
  try {
    auth = JSON.parse(raw);
  } catch {
    return { authenticated: false, accountLabel: null, authMessage: "auth.json 不是有效 JSON" };
  }
  const isChatGpt = String(auth.auth_mode || "").toLowerCase() === "chatgpt";
  const tokens = auth.tokens && typeof auth.tokens === "object" ? auth.tokens : null;
  const hasToken = tokens && ["access_token", "id_token", "refresh_token"].some((key) => String(tokens[key] || "").trim());
  if (!isChatGpt || !hasToken) {
    return { authenticated: false, accountLabel: null, authMessage: "未检测到 ChatGPT 官方登录态" };
  }
  return {
    authenticated: true,
    accountLabel: accountLabelFromTokens(tokens),
    authMessage: "已检测到 ChatGPT 官方登录态",
  };
}

async function readText(filePath) {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

async function writeProfileState({ codexHome, profiles, activeProfileId }) {
  const cleanProfiles = profiles
    .map((profile) => {
      try {
        return cleanRelayProfile(profile, profile.updatedAt || new Date().toISOString());
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  if (cleanProfiles.length === 0) {
    throw new Error("至少需要一个有效的中转配置");
  }
  const cleanActiveId = cleanProfiles.some((profile) => profile.id === activeProfileId) ? activeProfileId : cleanProfiles[0]?.id || "";
  const profileStorePath = path.join(codexHome, PROFILE_STORE_FILE);
  await fs.mkdir(codexHome, { recursive: true });
  await fs.writeFile(
    profileStorePath,
    `${JSON.stringify(
      {
        version: 1,
        activeProfileId: cleanActiveId,
        profiles: cleanProfiles,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  return readProfileState({ codexHome });
}

function normalizeProfileStore(store, fallbackProfile = null) {
  const now = new Date().toISOString();
  const rawProfiles = Array.isArray(store?.profiles) ? store.profiles : [];
  const profiles = rawProfiles
    .map((profile) => {
      try {
        return cleanRelayProfile(profile, now);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  if (profiles.length === 0 && fallbackProfile) {
    profiles.push(fallbackProfile);
  }
  if (profiles.length === 0) {
    profiles.push({
      id: "default",
      name: "Default",
      baseUrl: "",
      apiKey: "",
      note: "",
      createdAt: now,
      updatedAt: now,
    });
  }
  const seen = new Set();
  const deduped = profiles.map((profile) => {
    let id = profile.id || randomUUID();
    while (seen.has(id)) id = randomUUID();
    seen.add(id);
    return { ...profile, id };
  });
  const activeProfileId = deduped.some((profile) => profile.id === store?.activeProfileId)
    ? store.activeProfileId
    : fallbackProfile && deduped.some((profile) => profile.id === fallbackProfile.id)
      ? fallbackProfile.id
      : deduped[0].id;
  return {
    version: 1,
    activeProfileId,
    profiles: deduped,
  };
}

function cleanRelayProfile(profile, now = new Date().toISOString()) {
  const id = String(profile?.id || randomUUID()).trim() || randomUUID();
  const name = String(profile?.name || "Untitled").trim() || "Untitled";
  const baseUrl = String(profile?.baseUrl || "").trim();
  const apiKey = String(profile?.apiKey || "").trim();
  const note = String(profile?.note || "").trim();
  if (!baseUrl) throw new Error("Base URL 不能为空");
  if (!apiKey) throw new Error("API Key 不能为空");
  return {
    id,
    name,
    baseUrl,
    apiKey,
    note,
    createdAt: String(profile?.createdAt || now),
    updatedAt: now,
  };
}

function profileFromProviderStatus(status) {
  if (!status?.baseUrl || !status?.apiKey) return null;
  const now = new Date().toISOString();
  return {
    id: "default",
    name: "当前配置",
    baseUrl: status.baseUrl,
    apiKey: status.apiKey,
    note: "",
    createdAt: now,
    updatedAt: now,
  };
}

async function writeBackupIfNeeded(configPath, existing) {
  if (!existing.trim()) return null;
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "Z");
  const backupPath = `${configPath}.codex-switch-${stamp}.bak`;
  await fs.writeFile(backupPath, existing, "utf8");
  return backupPath;
}

function upsertRootStringKey(contents, key, value) {
  const lines = contents.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  const rootEnd = firstTableIndex(lines);
  const rootIndex = lines.findIndex((line, index) => index < rootEnd && rootKeyName(line) === key);
  const nextLine = `${key} = "${tomlEscape(value)}"`;
  if (rootIndex >= 0) {
    lines[rootIndex] = nextLine;
  } else {
    lines.splice(rootEnd, 0, nextLine);
  }
  return ensureTrailingNewline(lines.join("\n"));
}

function removeTable(contents, table) {
  const header = `[${table}]`;
  const lines = [];
  let skipping = false;
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === header) {
      skipping = true;
      continue;
    }
    if (skipping && trimmed.startsWith("[") && trimmed.endsWith("]")) {
      skipping = false;
    }
    if (!skipping) lines.push(line);
  }
  return ensureTrailingNewline(lines.join("\n").replace(/\n{3,}/g, "\n\n"));
}

function firstTableIndex(lines) {
  const index = lines.findIndex((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith("[") && trimmed.endsWith("]");
  });
  return index >= 0 ? index : lines.length;
}

function firstNonProviderTableIndex(lines) {
  const index = lines.findIndex((line) => {
    const trimmed = line.trim();
    return trimmed.startsWith("[") && trimmed.endsWith("]") && !trimmed.startsWith("[model_providers.");
  });
  return index >= 0 ? index : lines.length;
}

function rootKeyString(contents, key) {
  const lines = contents.split(/\r?\n/);
  const rootEnd = firstTableIndex(lines);
  for (let index = 0; index < rootEnd; index += 1) {
    const line = lines[index];
    if (rootKeyName(line) !== key) continue;
    const [, value = ""] = line.split(/=(.*)/s);
    return unquoteTomlString(value.trim());
  }
  return null;
}

function tableValues(contents, table) {
  const header = `[${table}]`;
  const values = {};
  let inside = false;
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === header) {
      inside = true;
      continue;
    }
    if (inside && trimmed.startsWith("[") && trimmed.endsWith("]")) break;
    if (!inside || !trimmed || trimmed.startsWith("#")) continue;
    const split = line.split(/=(.*)/s);
    if (split.length < 3) continue;
    values[split[0].trim()] = split[1].trim();
  }
  return inside ? values : null;
}

function rootKeyName(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) return null;
  return trimmed.split("=")[0].trim();
}

function tomlEscape(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

function unquoteTomlString(value) {
  const text = String(value || "").trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return text;
}

function ensureTrailingNewline(value) {
  return value.endsWith("\n") ? value : `${value}\n`;
}

function accountLabelFromTokens(tokens) {
  for (const key of ["id_token", "access_token"]) {
    const label = accountLabelFromJwt(tokens[key]);
    if (label) return label;
  }
  return null;
}

function accountLabelFromJwt(token) {
  const payload = String(token || "").split(".")[1];
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const json = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
    return json.email || json["https://api.openai.com/profile"]?.email || json.sub || null;
  } catch {
    return null;
  }
}
