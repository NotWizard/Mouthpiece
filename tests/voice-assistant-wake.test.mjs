import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function loadAgentDirectAddressModule() {
  const modulePath = pathToFileURL(
    path.resolve(process.cwd(), "src/utils/agentDirectAddress.mjs")
  ).href;

  try {
    return await import(modulePath);
  } catch {
    return {};
  }
}

test("agent direct address matcher recognizes Chinese punctuation and prefixes", async () => {
  const mod = await loadAgentDirectAddressModule();

  assert.equal(typeof mod.hasAgentDirectAddress, "function");
  assert.equal(mod.hasAgentDirectAddress("Mouthpiece，写一封正式邮件", "Mouthpiece"), true);
  assert.equal(mod.hasAgentDirectAddress("嘿 Mouthpiece，写一封正式邮件", "Mouthpiece"), true);
  assert.equal(mod.hasAgentDirectAddress("嘿，Mouthpiece，写一封正式邮件", "Mouthpiece"), true);
  assert.equal(mod.hasAgentDirectAddress("Hey, Mouthpiece, write a formal email", "Mouthpiece"), true);
  assert.equal(mod.hasAgentDirectAddress("请 Mouthpiece 把这段改得更专业。", "Mouthpiece"), true);
  assert.equal(
    mod.hasAgentDirectAddress("这段话，嘿，Mouthpiece，帮我改专业一点。", "Mouthpiece"),
    true
  );
  assert.equal(mod.hasAgentDirectAddress("嘴替：把这段改得更专业", "嘴替"), true);
});

test("agent direct address matcher does not treat plain mentions as wake phrases", async () => {
  const mod = await loadAgentDirectAddressModule();

  assert.equal(typeof mod.hasAgentDirectAddress, "function");
  assert.equal(mod.hasAgentDirectAddress("我刚刚和 Mouthpiece 聊了这个项目", "Mouthpiece"), false);
  assert.equal(mod.hasAgentDirectAddress("This project uses Mouthpiece for dictation", "Mouthpiece"), false);
  assert.equal(mod.hasAgentDirectAddress("Mouthpiece 真的很好用", "Mouthpiece"), false);
  assert.equal(mod.hasAgentDirectAddress("Mouthpiece is really helpful", "Mouthpiece"), false);
});

test("onboarding save path no longer forces voice assistant mode", async () => {
  const onboardingSource = await fs.readFile(
    path.resolve(process.cwd(), "src/components/OnboardingFlow.tsx"),
    "utf8"
  );

  assert.doesNotMatch(
    onboardingSource,
    /(setVoiceAssistantEnabled\(true\)|updateReasoningSettings\(\{\s*voiceAssistantEnabled:\s*true\s*\}\))/,
  );
});
