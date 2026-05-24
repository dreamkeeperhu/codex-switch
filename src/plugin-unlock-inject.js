(() => {
  window.__customCodexLiteUnlockObserver?.disconnect?.();
  if (window.__customCodexLiteUnlockTimer) clearInterval(window.__customCodexLiteUnlockTimer);
  window.__customCodexLiteUnlockInstalled = true;

  const selectors = {
    disabledInstallButton:
      'button:disabled, button[aria-disabled="true"], [role="button"][aria-disabled="true"], button[data-disabled], [role="button"][data-disabled], button.cursor-not-allowed, [role="button"].cursor-not-allowed, button.pointer-events-none, [role="button"].pointer-events-none',
    pluginNavButton: 'nav[role="navigation"] button.h-token-nav-row.w-full',
    pluginSvgPath: 'svg path[d^="M7.94562 14.0277"]',
  };
  const oldZhSuffix = ["已", "解", "锁"].join("");
  const oldEnSuffix = ["Un", "locked"].join("");
  const pluginEntryLabelPattern = new RegExp(`^(插件|Plugins)( - ${oldZhSuffix}| - ${oldEnSuffix})?$`, "i");
  const serviceTierModeKey = "codexSwitchServiceTierMode";
  const serviceTierPatchVersion = "1";
  const serviceTierFastValue = "priority";
  const serviceTierModes = new Set(["inherit", "standard", "fast"]);
  const serviceTierRequestMethods = new Set(["thread/start", "thread/resume", "turn/start"]);
  const serviceTierModulePromises = new Map();

  function reactFiberFrom(element) {
    const fiberKey = Object.keys(element || {}).find((key) => key.startsWith("__reactFiber"));
    return fiberKey ? element[fiberKey] : null;
  }

  function authContextValueFrom(element) {
    for (let fiber = reactFiberFrom(element); fiber; fiber = fiber.return) {
      for (const value of [fiber.memoizedProps?.value, fiber.pendingProps?.value]) {
        if (value && typeof value === "object" && typeof value.setAuthMethod === "function" && "authMethod" in value) {
          return value;
        }
      }
    }
    return null;
  }

  function spoofChatGPTAuthMethod(element) {
    const auth = authContextValueFrom(element);
    if (!auth || auth.authMethod === "chatgpt") return false;
    auth.setAuthMethod("chatgpt");
    return true;
  }

  function pluginEntryButton() {
    const byIcon = document.querySelector(`${selectors.pluginNavButton} ${selectors.pluginSvgPath}`)?.closest("button");
    if (byIcon) return byIcon;
    return (
      Array.from(document.querySelectorAll(selectors.pluginNavButton)).find((button) =>
        pluginEntryLabelPattern.test((button.textContent || "").trim()),
      ) || null
    );
  }

  function normalizePluginEntryLabel(button) {
    const labelTextNode = Array.from(button.querySelectorAll("span, div"))
      .reverse()
      .flatMap((node) => Array.from(node.childNodes))
      .find((node) => node.nodeType === 3 && pluginEntryLabelPattern.test((node.nodeValue || "").trim()));
    if (!labelTextNode) return;
    const current = (labelTextNode.nodeValue || "").trim();
    labelTextNode.nodeValue = /^Plugins/i.test(current) ? "Plugins" : "插件";
  }

  function enablePluginEntry() {
    const pluginButton = pluginEntryButton();
    if (!pluginButton) return false;
    spoofChatGPTAuthMethod(pluginButton);
    pluginButton.disabled = false;
    pluginButton.removeAttribute("disabled");
    pluginButton.removeAttribute("aria-disabled");
    pluginButton.removeAttribute("data-disabled");
    pluginButton.style.display = "";
    pluginButton.style.pointerEvents = "auto";
    pluginButton.querySelectorAll("*").forEach((node) => {
      node.style.display = "";
      node.style.pointerEvents = "";
    });
    normalizePluginEntryLabel(pluginButton);
    const reactPropsKey = Object.keys(pluginButton).find((key) => key.startsWith("__reactProps"));
    if (reactPropsKey && pluginButton[reactPropsKey]) {
      pluginButton[reactPropsKey].disabled = false;
    }
    if (pluginButton.dataset.customCodexLitePluginEnabled === "true") return true;
    pluginButton.dataset.customCodexLitePluginEnabled = "true";
    pluginButton.addEventListener("click", () => spoofChatGPTAuthMethod(pluginButton), true);
    return true;
  }

  function isInstallButtonLabel(text) {
    return /^安装\s*/.test(text) || /^Install\s*/i.test(text) || text === "强制安装";
  }

  function patchReactDisabledProps(element) {
    Object.keys(element)
      .filter((key) => key.startsWith("__reactProps"))
      .forEach((key) => {
        const props = element[key];
        if (!props || typeof props !== "object") return;
        props.disabled = false;
        props["aria-disabled"] = false;
        props["data-disabled"] = undefined;
      });
  }

  function clearDisabledState(element) {
    if (!(element instanceof HTMLElement)) return;
    if ("disabled" in element) element.disabled = false;
    element.removeAttribute("disabled");
    element.removeAttribute("aria-disabled");
    element.removeAttribute("data-disabled");
    element.removeAttribute("inert");
    element.classList.remove("disabled", "opacity-50", "cursor-not-allowed", "pointer-events-none");
    element.classList.add("codex-switch-force-install");
    element.style.pointerEvents = "auto";
    element.style.opacity = "1";
    element.style.cursor = "pointer";
    element.tabIndex = 0;
    patchReactDisabledProps(element);
  }

  function installButtonUnlockNodes(button) {
    const nodes = [button];
    button
      .querySelectorAll?.("button, [role='button'], [disabled], [aria-disabled], [data-disabled], .cursor-not-allowed, .pointer-events-none")
      .forEach((node) => nodes.push(node));
    let parent = button.parentElement;
    for (let depth = 0; parent && depth < 3; depth += 1, parent = parent.parentElement) {
      if (parent.matches?.("button, [role='button'], [disabled], [aria-disabled], [data-disabled], .cursor-not-allowed, .pointer-events-none")) {
        nodes.push(parent);
      }
    }
    return Array.from(new Set(nodes));
  }

  function installForcedInstallGuard(button) {
    if (button.dataset.customCodexLiteForceInstallReady === "true") return;
    button.dataset.customCodexLiteForceInstallReady = "true";
    const keepReady = () => installButtonUnlockNodes(button).forEach(clearDisabledState);
    ["pointerdown", "mousedown", "mouseup", "click", "focus"].forEach((eventName) => {
      button.addEventListener(eventName, keepReady, true);
    });
  }

  function labelForcedInstallButton(button) {
    const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (isInstallButtonLabel((node.nodeValue || "").trim())) {
        node.nodeValue = "强制安装";
        return;
      }
    }
  }

  function unblockPluginInstallButtons() {
    const buttons = Array.from(new Set(Array.from(document.querySelectorAll(selectors.disabledInstallButton)).map((node) => node.closest?.("button, [role='button']") || node)));
    buttons.forEach((button) => {
      const text = (button.textContent || "").trim();
      if (!isInstallButtonLabel(text)) return;
      installButtonUnlockNodes(button).forEach(clearDisabledState);
      installForcedInstallGuard(button);
      labelForcedInstallButton(button);
    });
  }

  function normalizeServiceTierMode(mode) {
    const normalized = String(mode || "inherit").trim().toLowerCase();
    return serviceTierModes.has(normalized) ? normalized : "inherit";
  }

  function readServiceTierMode() {
    try {
      return normalizeServiceTierMode(localStorage.getItem(serviceTierModeKey));
    } catch {
      return "inherit";
    }
  }

  function serviceTierForMode(mode = readServiceTierMode()) {
    if (mode === "fast") return serviceTierFastValue;
    if (mode === "standard") return null;
    return undefined;
  }

  function writeServiceTierMode(mode) {
    const normalized = normalizeServiceTierMode(mode);
    try {
      localStorage.setItem(serviceTierModeKey, normalized);
    } catch {
      // Ignore storage errors; the in-page controls can still reflect the request.
    }
    refreshServiceTierBadge();
    return serviceTierState();
  }

  function serviceTierState(extra = {}) {
    const mode = readServiceTierMode();
    const serviceTier = serviceTierForMode(mode);
    return {
      ok: true,
      mode,
      serviceTier: serviceTier === undefined ? "inherit" : serviceTier,
      patched: window.__codexSwitchServiceTierRequestOverrideInstalled === serviceTierPatchVersion,
      ...extra,
    };
  }

  function codexAppAssetUrl(namePart) {
    const urls = [
      ...Array.from(document.scripts || []).map((script) => script.src),
      ...Array.from(document.querySelectorAll("link[href]") || []).map((link) => link.href),
      ...performance.getEntriesByType("resource").map((entry) => entry.name),
    ].filter(Boolean);
    return urls.find((url) => url.includes("/assets/") && url.includes(namePart) && url.split("?")[0].endsWith(".js")) || "";
  }

  async function loadCodexAppModule(namePart) {
    if (!serviceTierModulePromises.has(namePart)) {
      serviceTierModulePromises.set(
        namePart,
        Promise.resolve().then(async () => {
          const url = codexAppAssetUrl(namePart);
          if (!url) throw new Error(`未找到 Codex asset: ${namePart}`);
          return await import(url);
        }),
      );
    }
    return await serviceTierModulePromises.get(namePart);
  }

  function serviceTierOverrideForRequest(method, params) {
    if (!serviceTierRequestMethods.has(method) || !params || typeof params !== "object") return params;
    const mode = readServiceTierMode();
    const serviceTier = serviceTierForMode(mode);
    if (serviceTier === undefined) return params;
    return { ...params, serviceTier };
  }

  function serviceTierOverrideMessage(message) {
    if (!message || typeof message !== "object") return message;
    if (message.type === "send-cli-request-for-host") {
      const method = String(message.method || "");
      const params = serviceTierOverrideForRequest(method, message.params);
      return params === message.params ? message : { ...message, params };
    }
    if (message.type === "mcp-request" && message.request && typeof message.request === "object") {
      const method = String(message.request.method || "");
      const params = serviceTierOverrideForRequest(method, message.request.params);
      return params === message.request.params ? message : { ...message, request: { ...message.request, params } };
    }
    if (message.type === "worker-request" && message.request && typeof message.request === "object") {
      const method = String(message.request.method || "");
      const params = serviceTierOverrideForRequest(method, message.request.params);
      return params === message.request.params ? message : { ...message, request: { ...message.request, params } };
    }
    if (message.type === "thread-prewarm-start" && message.request && typeof message.request === "object") {
      const params = serviceTierOverrideForRequest("thread/start", message.request.params);
      return params === message.request.params ? message : { ...message, request: { ...message.request, params } };
    }
    if (message.type === "prewarm-thread-start-for-host" && message.params && typeof message.params === "object") {
      const params = serviceTierOverrideForRequest("thread/start", message.params);
      return params === message.params ? message : { ...message, params };
    }
    if (message.type === "start-thread-for-host") {
      const params = serviceTierOverrideForRequest("thread/start", message);
      return params === message ? message : params;
    }
    if (message.type === "start-turn-for-host" && message.params && typeof message.params === "object") {
      const params = serviceTierOverrideForRequest("turn/start", message.params);
      return params === message.params ? message : { ...message, params };
    }
    if (message.type === "start-conversation") {
      const serviceTier = serviceTierForMode();
      return serviceTier === undefined ? message : { ...message, serviceTier };
    }
    return message;
  }

  async function installServiceTierDispatcherPatch() {
    if (window.__codexSwitchServiceTierRequestOverrideInstalled === serviceTierPatchVersion) return serviceTierState();
    try {
      const module = await loadCodexAppModule("setting-storage-");
      const dispatcherClass = typeof module.v === "function" && String(module.v).includes("dispatchMessage") ? module.v : null;
      const dispatcher = dispatcherClass?.getInstance?.();
      if (!dispatcher || typeof dispatcher.dispatchMessage !== "function") {
        throw new Error("Codex dispatcher unavailable");
      }
      if (!dispatcher.__codexSwitchOriginalDispatchMessage) {
        dispatcher.__codexSwitchOriginalDispatchMessage = dispatcher.dispatchMessage.bind(dispatcher);
      }
      dispatcher.dispatchMessage = (type, payload) => {
        const message = serviceTierOverrideMessage({ ...(payload || {}), type });
        const nextType = message?.type || type;
        const { type: _type, ...nextPayload } = message || {};
        return dispatcher.__codexSwitchOriginalDispatchMessage(nextType, nextPayload);
      };
      window.__codexSwitchServiceTierRequestOverrideInstalled = serviceTierPatchVersion;
      return serviceTierState();
    } catch (error) {
      return serviceTierState({ ok: false, error: error?.message || String(error) });
    }
  }

  function visibleElement(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }

  function serviceTierBadgeParent() {
    const footer = Array.from(document.querySelectorAll(".composer-footer")).find(visibleElement);
    if (footer) return footer;
    const input = Array.from(document.querySelectorAll("textarea, [contenteditable='true']")).find(visibleElement);
    return input?.closest?.("form") || input?.parentElement || null;
  }

  function wireServiceTierBadge(badge) {
    if (badge.dataset.codexSwitchServiceTierWired === "true") return;
    badge.dataset.codexSwitchServiceTierWired = "true";
    badge.setAttribute("role", "button");
    badge.setAttribute("tabindex", "0");
    const toggle = (event) => {
      event.preventDefault();
      event.stopPropagation();
      writeServiceTierMode(readServiceTierMode() === "fast" ? "standard" : "fast");
    };
    badge.addEventListener("click", toggle, true);
    badge.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      toggle(event);
    }, true);
  }

  function refreshServiceTierBadge() {
    const mode = readServiceTierMode();
    const existing = document.querySelector("[data-codex-switch-service-tier-badge='true']");
    if (mode === "inherit") {
      existing?.remove();
      return;
    }
    const parent = serviceTierBadgeParent();
    if (!parent) {
      existing?.remove();
      return;
    }
    const badge = existing || document.createElement("span");
    badge.className = "codex-switch-service-tier-badge";
    badge.dataset.codexSwitchServiceTierBadge = "true";
    badge.dataset.mode = mode;
    badge.textContent = mode === "fast" ? "fast" : "standard";
    badge.title = mode === "fast" ? 'Fast: serviceTier="priority"' : "Standard: serviceTier=null";
    wireServiceTierBadge(badge);
    if (badge.parentElement !== parent) parent.appendChild(badge);
  }

  function injectStyles() {
    if (document.getElementById("codex-switch-style")) return;
    const style = document.createElement("style");
    style.id = "codex-switch-style";
    style.textContent = `
      .codex-switch-force-install {
        border-color: #ef4444 !important;
        background: #fee2e2 !important;
        color: #991b1b !important;
        opacity: 1 !important;
      }
      .codex-switch-service-tier-badge {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        min-width: 54px !important;
        height: 28px !important;
        border: 1px solid rgba(22, 131, 255, .35) !important;
        border-radius: 999px !important;
        background: #eef6ff !important;
        color: #0b6fe0 !important;
        cursor: pointer !important;
        font: 750 12px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
        line-height: 1 !important;
        padding: 0 10px !important;
        user-select: none !important;
      }
      .codex-switch-service-tier-badge[data-mode="fast"] {
        border-color: rgba(16, 185, 129, .48) !important;
        background: #d9fbe9 !important;
        color: #047857 !important;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function unlockNow() {
    injectStyles();
    const entryEnabled = enablePluginEntry();
    unblockPluginInstallButtons();
    void installServiceTierDispatcherPatch();
    refreshServiceTierBadge();
    return entryEnabled;
  }

  window.__customCodexLiteUnlockNow = unlockNow;
  window.__codexSwitchSetServiceTierMode = (mode) => writeServiceTierMode(mode);
  window.__codexSwitchGetServiceTierState = () => serviceTierState();
  unlockNow();

  let unlockQueued = false;
  function scheduleUnlock() {
    if (unlockQueued) return;
    unlockQueued = true;
    const run = () => {
      unlockQueued = false;
      unlockNow();
    };
    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(run);
    } else {
      run();
    }
  }

  const observer = new MutationObserver(scheduleUnlock);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["disabled", "aria-disabled", "data-disabled", "class", "style"],
  });
  window.__customCodexLiteUnlockObserver = observer;
  return "codex-switch:installed";
})();
