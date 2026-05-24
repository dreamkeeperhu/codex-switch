import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  applyCustomProviderToContents,
  readCustomProviderStatus,
  readProfileState,
  saveRelayProfile,
  selectRelayProfile,
} from "../src/config.js";

test("writes custom provider without removing unrelated provider tables", () => {
  const input = `model = "gpt-5"\n\n[model_providers.old]\nname = "old"\nbase_url = "https://old.example/v1"\n\n[profiles.work]\nmodel = "gpt-5"\n`;
  const output = applyCustomProviderToContents(input, "https://relay.example/v1", "sk-test");
  assert.match(output, /model_provider = "custom"/);
  assert.match(output, /\[model_providers\.custom\]/);
  assert.match(output, /requires_openai_auth = true/);
  assert.match(output, /experimental_bearer_token = "sk-test"/);
  assert.match(output, /\[model_providers\.old\]/);
  assert.match(output, /\[profiles\.work\]/);
  assert.ok(output.indexOf("[model_providers.custom]") < output.indexOf("[profiles.work]"));
});

test("replaces previous custom provider table", () => {
  const input = `model_provider = "other"\n[model_providers.custom]\nbase_url = "old"\nexperimental_bearer_token = "old"\n[model_providers.keep]\nname = "keep"\n`;
  const output = applyCustomProviderToContents(input, "https://new.example/v1", "sk-new");
  assert.equal((output.match(/\[model_providers\.custom\]/g) || []).length, 1);
  assert.doesNotMatch(output, /base_url = "old"/);
  assert.match(output, /base_url = "https:\/\/new\.example\/v1"/);
  assert.match(output, /\[model_providers\.keep\]/);
});

test("detects configured custom provider", () => {
  const output = applyCustomProviderToContents("", "https://relay.example/v1", "sk-test");
  const status = readCustomProviderStatus(output);
  assert.equal(status.provider, "custom");
  assert.equal(status.configured, true);
  assert.equal(status.requiresOpenaiAuth, true);
  assert.equal(status.hasBearerToken, true);
  assert.equal(status.baseUrl, "https://relay.example/v1");
  assert.equal(status.apiKey, "sk-test");
});

test("saves and selects multiple relay profiles", async () => {
  const codexHome = await mkdtemp(path.join(os.tmpdir(), "codex-switch-"));
  try {
    const first = await saveRelayProfile(
      {
        id: "a",
        name: "Alpha",
        baseUrl: "https://alpha.example/v1",
        apiKey: "sk-alpha",
      },
      { codexHome },
    );
    assert.equal(first.profiles.length, 1);
    assert.equal(first.activeProfileId, "a");

    const second = await saveRelayProfile(
      {
        id: "b",
        name: "Beta",
        baseUrl: "https://beta.example/v1",
        apiKey: "sk-beta",
      },
      { codexHome },
    );
    assert.equal(second.profiles.length, 2);

    const selected = await selectRelayProfile("b", { codexHome });
    assert.equal(selected.activeProfileId, "b");
    assert.equal(selected.status.baseUrl, "https://beta.example/v1");

    const state = await readProfileState({ codexHome });
    assert.equal(state.activeProfile.name, "Beta");
  } finally {
    await rm(codexHome, { recursive: true, force: true });
  }
});
