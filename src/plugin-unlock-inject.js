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
    `;
    document.documentElement.appendChild(style);
  }

  function unlockNow() {
    injectStyles();
    const entryEnabled = enablePluginEntry();
    unblockPluginInstallButtons();
    return entryEnabled;
  }

  window.__customCodexLiteUnlockNow = unlockNow;
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
