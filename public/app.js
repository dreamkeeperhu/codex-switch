const providerList = document.querySelector("#providerList");
const profileForm = document.querySelector("#profileForm");
const addProfileButton = document.querySelector("#addProfileButton");
const saveProfileButton = document.querySelector("#saveProfileButton");
const useProfileButton = document.querySelector("#useProfileButton");
const testProfileButton = document.querySelector("#testProfileButton");
const deleteProfileButton = document.querySelector("#deleteProfileButton");
const launchButton = document.querySelector("#launchButton");
const injectButton = document.querySelector("#injectButton");
const refreshButton = document.querySelector("#refreshButton");
const logOutput = document.querySelector("#logOutput");
const serviceTierButtons = Array.from(document.querySelectorAll("[data-service-tier-mode]"));

const fields = {
  profileId: document.querySelector("#profileId"),
  profileName: document.querySelector("#profileName"),
  baseUrl: document.querySelector("#baseUrl"),
  apiKey: document.querySelector("#apiKey"),
  profileNote: document.querySelector("#profileNote"),
  codexAppPath: document.querySelector("#codexAppPath"),
  debugPort: document.querySelector("#debugPort"),
};

const statusNodes = {
  auth: document.querySelector("#authStatus"),
  provider: document.querySelector("#providerStatus"),
  activeProfile: document.querySelector("#activeProfileStatus"),
  app: document.querySelector("#appStatus"),
  serviceTier: document.querySelector("#serviceTierStatus"),
  configPath: document.querySelector("#configPath"),
  lastUpdated: document.querySelector("#lastUpdated"),
  profileCount: document.querySelector("#profileCount"),
  editorTitle: document.querySelector("#editorTitle"),
};

const appState = {
  profiles: [],
  activeProfileId: "",
  selectedProfileId: "",
  status: null,
  serviceTierMode: "inherit",
};

profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await withBusy(saveProfileButton, async () => {
    const result = await postJson("/api/profiles/save", { profile: formProfile() });
    applyProfiles(result.profiles);
    writeLog(result);
    selectProfile(formProfile().id || result.profiles.activeProfileId);
  });
});

addProfileButton.addEventListener("click", () => {
  const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
  selectDraft({
    id,
    name: "",
    baseUrl: "",
    apiKey: "",
    note: "",
  });
});

useProfileButton.addEventListener("click", async () => {
  await withBusy(useProfileButton, async () => {
    const profile = formProfile();
    if (!existingProfile(profile.id)) {
      const saved = await postJson("/api/profiles/save", { profile });
      applyProfiles(saved.profiles);
    }
    const result = await postJson("/api/profiles/select", { id: profile.id, apply: true });
    applyProfiles(result.profiles);
    renderStatus(result.status);
    writeLog(result);
  });
});

testProfileButton.addEventListener("click", async () => {
  await withBusy(testProfileButton, async () => {
    const result = await postJson("/api/test-profile", { profile: formProfile() });
    writeLog(result);
  });
});

deleteProfileButton.addEventListener("click", async () => {
  const profile = formProfile();
  if (!existingProfile(profile.id)) {
    selectProfile(appState.activeProfileId || appState.profiles[0]?.id || "");
    return;
  }
  if (!confirm(`删除中转配置「${profile.name || "Untitled"}」？`)) return;
  await withBusy(deleteProfileButton, async () => {
    const result = await postJson("/api/profiles/delete", { id: profile.id });
    applyProfiles(result.profiles);
    renderStatus(result.status);
    writeLog(result);
    selectProfile(result.profiles.activeProfileId);
  });
});

launchButton.addEventListener("click", async () => {
  await withBusy(launchButton, async () => {
    const profile = formProfile();
    if (profile.baseUrl && profile.apiKey && !existingProfile(profile.id)) {
      const saved = await postJson("/api/profiles/save", { profile });
      applyProfiles(saved.profiles);
    }
    const result = await postJson("/api/launch", {
      codexAppPath: fields.codexAppPath.value.trim(),
      debugPort: Number(fields.debugPort.value || 9229),
      applyActive: true,
    });
    renderStatus(result.status);
    writeLog(result);
  });
});

injectButton.addEventListener("click", async () => {
  await withBusy(injectButton, async () => {
    const result = await postJson("/api/inject", { debugPort: Number(fields.debugPort.value || 9229) });
    renderStatus(result.status);
    writeLog(result);
  });
});

refreshButton.addEventListener("click", () => refreshStatus());

serviceTierButtons.forEach((button) => {
  button.addEventListener("click", async () => {
    const mode = button.getAttribute("data-service-tier-mode") || "inherit";
    await withBusy(button, async () => {
      const result = await postJson("/api/service-tier", {
        mode,
        debugPort: Number(fields.debugPort.value || 9229),
        apply: true,
      });
      renderStatus(result.status);
      renderServiceTier(result.settings, result.page);
      writeLog(result);
    });
  });
});

await refreshStatus();

async function refreshStatus() {
  const result = await getJson("/api/status");
  renderStatus(result.status);
  applyProfiles({
    profiles: result.status.profiles || [],
    activeProfileId: result.status.activeProfileId || "",
    activeProfile: result.status.activeProfile || null,
  });
  if (!appState.selectedProfileId) {
    selectProfile(appState.activeProfileId || appState.profiles[0]?.id || "");
  }
  writeLog(result);
}

function applyProfiles(state) {
  appState.profiles = state?.profiles || [];
  appState.activeProfileId = state?.activeProfileId || "";
  statusNodes.profileCount.textContent = String(appState.profiles.length);
  renderProviders();
}

function renderProviders() {
  if (appState.profiles.length === 0) {
    providerList.innerHTML = `<div class="empty-state">还没有中转配置。</div>`;
    return;
  }
  providerList.innerHTML = "";
  for (const profile of appState.profiles) {
    const card = document.createElement("article");
    const active = profile.id === appState.activeProfileId;
    card.className = `provider-card${active ? " active" : ""}`;
    card.innerHTML = `
      <div class="drag-dots">⋮⋮</div>
      <div class="provider-icon">${escapeHtml(providerInitial(profile.name))}</div>
      <div class="provider-main">
        <div class="provider-title-row">
          <span class="provider-name">${escapeHtml(profile.name || "Untitled")}</span>
          ${active ? `<span class="current-badge">当前使用</span>` : ""}
        </div>
        <div class="provider-url">${escapeHtml(profile.baseUrl || "未配置接口地址")}</div>
        ${profile.note ? `<div class="provider-note">${escapeHtml(profile.note)}</div>` : ""}
      </div>
      <div class="provider-actions">
        <button class="secondary" type="button" data-action="edit">编辑</button>
        <button type="button" data-action="use">使用</button>
      </div>
    `;
    card.querySelector('[data-action="edit"]').addEventListener("click", () => selectProfile(profile.id));
    card.querySelector('[data-action="use"]').addEventListener("click", () => useProfileFromCard(profile.id));
    card.addEventListener("dblclick", () => selectProfile(profile.id));
    providerList.appendChild(card);
  }
}

async function useProfileFromCard(id) {
  await withBusy(useProfileButton, async () => {
    const result = await postJson("/api/profiles/select", { id, apply: true });
    applyProfiles(result.profiles);
    renderStatus(result.status);
    writeLog(result);
    selectProfile(id);
  });
}

function selectProfile(id) {
  const profile = existingProfile(id) || appState.profiles[0];
  if (!profile) return;
  selectDraft(profile);
}

function selectDraft(profile) {
  appState.selectedProfileId = profile.id || "";
  fields.profileId.value = profile.id || "";
  fields.profileName.value = profile.name || "";
  fields.baseUrl.value = profile.baseUrl || "";
  fields.apiKey.value = profile.apiKey || "";
  fields.profileNote.value = profile.note || "";
  statusNodes.editorTitle.textContent = existingProfile(profile.id) ? "配置详情" : "添加中转";
  renderProviders();
}

function formProfile() {
  return {
    id: fields.profileId.value.trim(),
    name: fields.profileName.value.trim() || "Untitled",
    baseUrl: fields.baseUrl.value.trim(),
    apiKey: fields.apiKey.value.trim(),
    note: fields.profileNote.value.trim(),
  };
}

function existingProfile(id) {
  return appState.profiles.find((profile) => profile.id === id) || null;
}

function renderStatus(status) {
  if (!status) return;
  appState.status = status;
  renderServiceTier(status.switchSettings);
  statusNodes.auth.textContent = status.authenticated ? status.accountLabel || "已登录" : "未登录";
  statusNodes.auth.className = status.authenticated ? "ok" : "bad";
  statusNodes.provider.textContent = status.provider || "-";
  statusNodes.activeProfile.textContent = status.activeProfile?.name || (status.configured ? "custom" : "未写入");
  statusNodes.activeProfile.className = status.configured ? "ok" : "bad";
  statusNodes.app.textContent = status.codexApp || "未找到";
  statusNodes.app.className = status.codexApp ? "ok" : "bad";
  statusNodes.configPath.textContent = status.configPath || "~/.codex/config.toml";
  if (status.codexApp && !fields.codexAppPath.value) fields.codexAppPath.value = status.codexApp;
  statusNodes.lastUpdated.textContent = new Date().toLocaleTimeString();
}

function renderServiceTier(settings, page = null) {
  const mode = settings?.serviceTierMode || appState.serviceTierMode || "inherit";
  appState.serviceTierMode = mode;
  statusNodes.serviceTier.textContent = serviceTierLabel(mode);
  statusNodes.serviceTier.className = mode === "fast" ? "ok" : "";
  serviceTierButtons.forEach((button) => {
    const active = button.getAttribute("data-service-tier-mode") === mode;
    button.dataset.active = String(active);
  });
  if (page?.ok && page.mode && page.mode !== mode) {
    statusNodes.serviceTier.textContent = `${serviceTierLabel(mode)} / 页面 ${serviceTierLabel(page.mode)}`;
  }
}

async function withBusy(button, task) {
  button.disabled = true;
  try {
    await task();
  } catch (error) {
    writeLog({ ok: false, error: error.message || String(error) });
  } finally {
    button.disabled = false;
  }
}

async function getJson(url) {
  const response = await fetch(url);
  return parseJsonResponse(response);
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseJsonResponse(response);
}

async function parseJsonResponse(response) {
  const body = await response.json();
  if (!response.ok || body.ok === false) {
    throw new Error(body.error || `HTTP ${response.status}`);
  }
  return body;
}

function writeLog(value) {
  logOutput.textContent = JSON.stringify(redact(value), null, 2);
}

function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== "object") return value;
  const next = {};
  for (const [key, item] of Object.entries(value)) {
    if (/apiKey|bearer|token|authorization/i.test(key)) {
      next[key] = item ? "redacted" : item;
    } else {
      next[key] = redact(item);
    }
  }
  return next;
}

function providerInitial(name) {
  const clean = String(name || "C").trim();
  return clean[0]?.toUpperCase() || "C";
}

function serviceTierLabel(mode) {
  if (mode === "fast") return "Fast";
  if (mode === "standard") return "Standard";
  return "继承";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
