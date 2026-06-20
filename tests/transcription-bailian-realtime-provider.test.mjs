import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

async function readRepoFile(relativePath) {
  return fs.readFile(path.resolve(process.cwd(), relativePath), "utf8");
}

async function loadQwenRealtimeStreaming() {
  const modulePath = pathToFileURL(
    path.resolve(process.cwd(), "src/helpers/qwenRealtimeStreaming.js")
  ).href;
  const mod = await import(modulePath);
  return mod.default ?? mod;
}

function createFakeSocket(sentEvents = []) {
  const socket = new EventEmitter();
  socket.readyState = 1;
  socket.closed = false;
  socket.terminated = false;
  socket.send = (payload) => {
    sentEvents.push(JSON.parse(payload));
  };
  socket.close = () => {
    socket.closed = true;
  };
  socket.terminate = () => {
    socket.terminated = true;
  };
  return socket;
}

test("legacy Bailian realtime setting is retained only for migration compatibility", async () => {
  const [settingsStoreSource, settingsHookSource] = await Promise.all([
    readRepoFile("src/stores/settingsStore.ts"),
    readRepoFile("src/hooks/useSettings.ts"),
  ]);

  assert.match(settingsStoreSource, /"bailianRealtimeEnabled"/);
  assert.match(
    settingsStoreSource,
    /bailianRealtimeEnabled: readBoolean\("bailianRealtimeEnabled", false\)/
  );
  assert.match(
    settingsStoreSource,
    /setBailianRealtimeEnabled: createBooleanSetter\("bailianRealtimeEnabled"\)/
  );
  assert.match(settingsStoreSource, /migrateLegacyBailianRealtimeModel/);

  assert.match(settingsHookSource, /bailianRealtimeEnabled: boolean;/);
  assert.match(settingsHookSource, /bailianRealtimeEnabled: store\.bailianRealtimeEnabled,/);
  assert.match(settingsHookSource, /setBailianRealtimeEnabled: store\.setBailianRealtimeEnabled,/);
});

test("Bailian transcription capsule derives realtime mode from the selected model", async () => {
  const [transcriptionSource, settingsPageSource] = await Promise.all([
    readRepoFile("src/components/TranscriptionModelPicker.tsx"),
    readRepoFile("src/components/SettingsPage.tsx"),
  ]);

  assert.doesNotMatch(transcriptionSource, /bailianRealtimeEnabled\??: boolean;/);
  assert.doesNotMatch(
    transcriptionSource,
    /setBailianRealtimeEnabled\??: \(enabled: boolean\) => void;/
  );
  assert.doesNotMatch(transcriptionSource, /checked=\{bailianRealtimeEnabled\}/);
  assert.match(
    transcriptionSource,
    /selectedCloudProvider === "bailian"[\s\S]*renderBailianModelModeHint/
  );
  assert.match(transcriptionSource, /getBailianQwenAsrMode\(selectedCloudModel\)/);
  assert.match(
    transcriptionSource,
    /transcription\.bailian\.modelMode\.\$\{selectedBailianMode\}\.title/
  );

  assert.doesNotMatch(settingsPageSource, /bailianRealtimeEnabled=\{bailianRealtimeEnabled\}/);
  assert.doesNotMatch(
    settingsPageSource,
    /setBailianRealtimeEnabled=\{setBailianRealtimeEnabled\}/
  );
});

test("Bailian model-mode locale keys exist across every supported translation file", async () => {
  const localeFiles = [
    "src/locales/en/translation.json",
    "src/locales/de/translation.json",
    "src/locales/es/translation.json",
    "src/locales/fr/translation.json",
    "src/locales/it/translation.json",
    "src/locales/ja/translation.json",
    "src/locales/pt/translation.json",
    "src/locales/ru/translation.json",
    "src/locales/zh-CN/translation.json",
    "src/locales/zh-TW/translation.json",
  ];

  const localeSources = await Promise.all(localeFiles.map(readRepoFile));

  for (const source of localeSources) {
    const parsed = JSON.parse(source);
    assert.equal(typeof parsed?.transcription?.bailian?.modelMode?.label, "string");
    assert.equal(typeof parsed?.transcription?.bailian?.modelMode?.batch?.title, "string");
    assert.equal(typeof parsed?.transcription?.bailian?.modelMode?.batch?.description, "string");
    assert.equal(typeof parsed?.transcription?.bailian?.modelMode?.realtime?.title, "string");
    assert.equal(typeof parsed?.transcription?.bailian?.modelMode?.realtime?.description, "string");
    assert.equal(typeof parsed?.transcription?.bailian?.modelMode?.selectModel, "string");
  }
});

test("audio manager routes Bailian realtime separately from Bailian batch transcription", async () => {
  const source = await readRepoFile("src/helpers/audioManager.js");

  assert.match(source, /STREAMING_PROVIDERS[\s\S]*bailian:/);
  assert.match(source, /bailianRealtimeWarmup/);
  assert.match(source, /bailianRealtimeStart/);
  assert.match(source, /bailianRealtimeSend/);
  assert.match(source, /bailianRealtimeFinalize/);
  assert.match(source, /bailianRealtimeStop/);
  assert.match(source, /bailianRealtimeStatus/);
  assert.match(source, /isByokBailianStreamingEnabled\(\)/);
  assert.match(
    source,
    /isByokBailianStreamingEnabled\(\) \{[\s\S]*getBailianQwenAsrMode\(s\.cloudTranscriptionModel\) === "realtime";/
  );
  assert.match(
    source,
    /getBatchTranscriptionModel\(\) \{[\s\S]*getBailianBatchTranscriptionModel\(trimmedModel\)/
  );
  assert.match(
    source,
    /getRealtimeStreamingModel\(\) \{[\s\S]*getBailianRealtimeTranscriptionModel\(trimmedModel\)/
  );
  assert.match(
    source,
    /getStreamingRequestOptions\(\) \{[\s\S]*this\.isByokBailianStreamingEnabled\(\)[\s\S]*model: this\.getRealtimeStreamingModel\(\)/
  );
  assert.match(
    source,
    /shouldUseStreaming\(isSignedInOverride\) \{[\s\S]*this\.isByokBailianStreamingEnabled\(\)/
  );
  assert.match(source, /const isByokBailianStreaming = this\.isByokBailianStreamingEnabled\(\);/);
});

test("Bailian realtime routing is selected from the model without renderer API key gating", async () => {
  const source = await readRepoFile("src/helpers/audioManager.js");
  const match = source.match(/isByokBailianStreamingEnabled\(\) \{(?<body>[\s\S]*?)\n  \}/);

  assert.ok(match?.groups?.body, "expected isByokBailianStreamingEnabled method body");
  assert.match(match.groups.body, /s\.cloudTranscriptionProvider === "bailian"/);
  assert.match(match.groups.body, /getBailianQwenAsrMode\(s\.cloudTranscriptionModel\) === "realtime"/);
  assert.doesNotMatch(match.groups.body, /s\.bailianApiKey/);
  assert.doesNotMatch(match.groups.body, /isValidApiKey\([^)]*"bailian"[^)]*\)/);
});

test("main-process bridge exposes Bailian realtime IPC and dedicated realtime helper", async () => {
  const [preloadSource, ipcHandlersSource, electronTypes, realtimeHelperSource] = await Promise.all(
    [
      readRepoFile("preload.js"),
      readRepoFile("src/helpers/ipcHandlers.js"),
      readRepoFile("src/types/electron.ts"),
      readRepoFile("src/helpers/qwenRealtimeStreaming.js"),
    ]
  );

  assert.match(preloadSource, /bailianRealtimeWarmup/);
  assert.match(preloadSource, /bailianRealtimeStart/);
  assert.match(preloadSource, /bailianRealtimeSend/);
  assert.match(preloadSource, /bailianRealtimeFinalize/);
  assert.match(preloadSource, /bailianRealtimeStop/);
  assert.match(preloadSource, /bailianRealtimeStatus/);
  assert.match(preloadSource, /onBailianRealtimePartialTranscript/);
  assert.match(preloadSource, /onBailianRealtimeFinalTranscript/);
  assert.match(preloadSource, /onBailianRealtimeError/);
  assert.match(preloadSource, /onBailianRealtimeSpeechStarted/);
  assert.match(preloadSource, /onBailianRealtimeSessionEnd/);

  assert.match(
    ipcHandlersSource,
    /const QwenRealtimeStreaming = require\("\.\/qwenRealtimeStreaming"\);/
  );
  assert.match(ipcHandlersSource, /this\.bailianRealtimeStreaming = null;/);
  assert.match(ipcHandlersSource, /"bailian-realtime-warmup"/);
  assert.match(ipcHandlersSource, /"bailian-realtime-start"/);
  assert.match(ipcHandlersSource, /"bailian-realtime-send"/);
  assert.match(ipcHandlersSource, /"bailian-realtime-finalize"/);
  assert.match(ipcHandlersSource, /"bailian-realtime-stop"/);
  assert.match(ipcHandlersSource, /"bailian-realtime-status"/);

  assert.match(electronTypes, /bailianRealtimeWarmup/);
  assert.match(electronTypes, /bailianRealtimeStart/);
  assert.match(electronTypes, /bailianRealtimeSend/);
  assert.match(electronTypes, /bailianRealtimeFinalize/);
  assert.match(electronTypes, /bailianRealtimeStop/);
  assert.match(electronTypes, /bailianRealtimeStatus/);
  assert.match(electronTypes, /onBailianRealtimePartialTranscript/);
  assert.match(electronTypes, /onBailianRealtimeFinalTranscript/);
  assert.match(electronTypes, /onBailianRealtimeError/);
  assert.match(electronTypes, /onBailianRealtimeSpeechStarted/);
  assert.match(electronTypes, /onBailianRealtimeSessionEnd/);

  assert.match(
    realtimeHelperSource,
    /wss:\/\/dashscope\.aliyuncs\.com\/api-ws\/v1\/realtime\?model=qwen3-asr-flash-realtime/
  );
  assert.match(realtimeHelperSource, /Authorization: `Bearer \$\{apiKey\}`/);
  assert.match(realtimeHelperSource, /"session\.update"/);
  assert.match(realtimeHelperSource, /"input_audio_buffer\.append"/);
  assert.match(realtimeHelperSource, /"input_audio_buffer\.commit"/);
  assert.match(realtimeHelperSource, /input_audio_buffer\.speech_started/);
  assert.match(realtimeHelperSource, /"session\.finish"/);
  assert.match(realtimeHelperSource, /conversation\.item\.input_audio_transcription\.text/);
  assert.match(realtimeHelperSource, /conversation\.item\.input_audio_transcription\.completed/);
  assert.match(realtimeHelperSource, /text.*stash|stash.*text/);
});

test("Bailian realtime helper surfaces server speech-start events before partial text is finalized", async () => {
  const QwenRealtimeStreaming = await loadQwenRealtimeStreaming();
  const streaming = new QwenRealtimeStreaming();
  const speechStarts = [];

  streaming.onSpeechStarted = (data) => speechStarts.push(data);
  streaming.handleMessage(
    JSON.stringify({
      type: "input_audio_buffer.speech_started",
      item_id: "turn-1",
      audio_start_ms: 120,
    })
  );

  assert.deepEqual(speechStarts, [
    {
      itemId: "turn-1",
      audioStartMs: 120,
    },
  ]);
});

test("Bailian realtime session config keeps server VAD enabled for live partial transcripts", async () => {
  const QwenRealtimeStreaming = await loadQwenRealtimeStreaming();
  const streaming = new QwenRealtimeStreaming();

  const event = streaming.buildSessionUpdateEvent({
    apiKey: "test-key",
    language: "zh",
  });

  assert.equal(event.type, "session.update");
  assert.deepEqual(event.session.turn_detection, {
    type: "server_vad",
    threshold: 0.5,
    silence_duration_ms: 1200,
    prefix_padding_ms: 300,
  });
});

test("Bailian realtime finalize does not send manual commit events while VAD mode is enabled", async () => {
  const QwenRealtimeStreaming = await loadQwenRealtimeStreaming();
  const streaming = new QwenRealtimeStreaming();
  const sentEvents = [];

  streaming.ws = {
    readyState: 1,
    send(payload) {
      sentEvents.push(JSON.parse(payload));
    },
  };
  streaming.sessionConfigured = true;

  const didFinalize = streaming.finalize();

  assert.equal(didFinalize, false);
  assert.deepEqual(sentEvents, []);
});

test("Bailian realtime connect flushes audio buffered before startup completes", async () => {
  const QwenRealtimeStreaming = await loadQwenRealtimeStreaming();
  const streaming = new QwenRealtimeStreaming();
  const sentEvents = [];
  const socket = {
    readyState: 1,
    send(payload) {
      sentEvents.push(JSON.parse(payload));
    },
    removeAllListeners() {},
    on() {},
    close() {},
    terminate() {},
  };

  streaming.sendAudio(Buffer.alloc(640, 1));
  streaming.createConfiguredSocket = async () => ({
    socket,
    sessionId: "session-1",
    model: "qwen3-asr-flash-realtime",
  });

  await streaming.connect({
    apiKey: "test-key",
    language: "zh",
  });

  const appendEvents = sentEvents.filter(
    (event) => event.type === "input_audio_buffer.append"
  );
  assert.equal(appendEvents.length, 1);
  assert.equal(streaming.audioBytesSent, 640);
  assert.equal(streaming.pendingAudioBytes, 0);
});

test("Bailian realtime IPC creates the helper before accepting pre-start audio", async () => {
  const source = await readRepoFile("src/helpers/ipcHandlers.js");
  const sendHandler = source.match(
    /ipcMain\.on\("bailian-realtime-send",[\s\S]*?\n    \}\);/
  )?.[0];

  assert.ok(sendHandler, "expected Bailian realtime send handler");
  assert.match(
    sendHandler,
    /if \(!this\.bailianRealtimeStreaming\) \{\s*this\.bailianRealtimeStreaming = new QwenRealtimeStreaming\(\);\s*\}/
  );
  assert.match(sendHandler, /this\.bailianRealtimeStreaming\.sendAudio\(buffer\)/);
});

test("Bailian realtime drops expired warm connections before starting a session", async () => {
  const QwenRealtimeStreaming = await loadQwenRealtimeStreaming();
  const streaming = new QwenRealtimeStreaming();
  const expiredSocket = createFakeSocket();
  const coldSocket = createFakeSocket();
  let coldConnects = 0;

  streaming.attachWarmConnection(
    expiredSocket,
    { apiKey: "test-key", language: "zh" },
    "warm-session",
    "qwen3-asr-flash-realtime"
  );
  streaming.warmConnectionCreatedAt = Date.now() - 10 * 60 * 1000;
  streaming.createConfiguredSocket = async () => {
    coldConnects += 1;
    return {
      socket: coldSocket,
      sessionId: "cold-session",
      model: "qwen3-asr-flash-realtime",
    };
  };

  await streaming.connect({ apiKey: "test-key", language: "zh" });

  assert.equal(coldConnects, 1);
  assert.equal(expiredSocket.terminated, true);
  assert.equal(streaming.ws, coldSocket);
  assert.equal(streaming.sessionId, "cold-session");
});

test("Bailian realtime reconnects a stale warm session and replays early audio once", async () => {
  const QwenRealtimeStreaming = await loadQwenRealtimeStreaming();
  const streaming = new QwenRealtimeStreaming();
  const warmEvents = [];
  const coldEvents = [];
  const warmSocket = createFakeSocket(warmEvents);
  const coldSocket = createFakeSocket(coldEvents);
  let coldConnects = 0;
  const errors = [];

  streaming.onError = (error) => errors.push(error);
  streaming.attachWarmConnection(
    warmSocket,
    { apiKey: "test-key", language: "zh" },
    "warm-session",
    "qwen3-asr-flash-realtime"
  );
  await streaming.connect({ apiKey: "test-key", language: "zh" });

  streaming.createConfiguredSocket = async () => {
    coldConnects += 1;
    return {
      socket: coldSocket,
      sessionId: "cold-session",
      model: "qwen3-asr-flash-realtime",
    };
  };
  streaming.sendAudio(Buffer.alloc(640, 1));
  await streaming.handleWarmConnectionLivenessTimeout();

  assert.equal(coldConnects, 1);
  assert.equal(errors.length, 0);
  assert.equal(streaming.ws, coldSocket);
  assert.equal(streaming.sessionId, "cold-session");
  assert.equal(
    warmEvents.filter((event) => event.type === "input_audio_buffer.append").length,
    1
  );
  assert.equal(
    coldEvents.filter((event) => event.type === "input_audio_buffer.append").length,
    1
  );
  assert.equal(streaming.audioBytesSent, 1280);

  await streaming.handleWarmConnectionLivenessTimeout();
  assert.equal(coldConnects, 1);
});

test("Bailian realtime cancels warm stale detection once any server event arrives", async () => {
  const QwenRealtimeStreaming = await loadQwenRealtimeStreaming();
  const streaming = new QwenRealtimeStreaming();
  const warmSocket = createFakeSocket();

  streaming.attachWarmConnection(
    warmSocket,
    { apiKey: "test-key", language: "zh" },
    "warm-session",
    "qwen3-asr-flash-realtime"
  );
  await streaming.connect({ apiKey: "test-key", language: "zh" });
  streaming.sendAudio(Buffer.alloc(640, 1));

  assert.notEqual(streaming.warmConnectionLivenessTimer, null);

  streaming.handleMessage(
    JSON.stringify({
      type: "input_audio_buffer.speech_started",
      item_id: "turn-1",
      audio_start_ms: 20,
    })
  );

  assert.equal(streaming.warmConnectionLivenessTimer, null);
  await streaming.handleWarmConnectionLivenessTimeout();
  assert.equal(streaming.ws, warmSocket);
});

test("Bailian realtime retries a warm session close before surfacing connection loss", async () => {
  const QwenRealtimeStreaming = await loadQwenRealtimeStreaming();
  const streaming = new QwenRealtimeStreaming();
  const warmEvents = [];
  const coldEvents = [];
  const warmSocket = createFakeSocket(warmEvents);
  const coldSocket = createFakeSocket(coldEvents);
  const errors = [];
  const sessionEnds = [];
  let coldConnects = 0;

  streaming.onError = (error) => errors.push(error);
  streaming.onSessionEnd = (data) => sessionEnds.push(data);
  streaming.attachWarmConnection(
    warmSocket,
    { apiKey: "test-key", language: "zh" },
    "warm-session",
    "qwen3-asr-flash-realtime"
  );
  await streaming.connect({ apiKey: "test-key", language: "zh" });
  streaming.createConfiguredSocket = async () => {
    coldConnects += 1;
    return {
      socket: coldSocket,
      sessionId: "cold-session",
      model: "qwen3-asr-flash-realtime",
    };
  };

  streaming.sendAudio(Buffer.alloc(640, 1));
  warmSocket.emit("close", 1006, Buffer.from(""));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(coldConnects, 1);
  assert.equal(errors.length, 0);
  assert.equal(sessionEnds.length, 0);
  assert.equal(streaming.ws, coldSocket);
  assert.equal(
    coldEvents.filter((event) => event.type === "input_audio_buffer.append").length,
    1
  );
});

test("Bailian realtime keeps contiguous Chinese transcript segments compact across VAD turns", async () => {
  const QwenRealtimeStreaming = await loadQwenRealtimeStreaming();
  const streaming = new QwenRealtimeStreaming();
  const partials = [];
  const finals = [];

  streaming.currentLanguage = "zh";
  streaming.onPartialTranscript = (payload) => partials.push(payload);
  streaming.onFinalTranscript = (text) => finals.push(text);

  streaming.handleMessage(
    JSON.stringify({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "turn-1",
      transcript: "你好",
    })
  );
  streaming.handleMessage(
    JSON.stringify({
      type: "conversation.item.input_audio_transcription.text",
      text: "世界",
      stash: "",
    })
  );
  streaming.handleMessage(
    JSON.stringify({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "turn-2",
      transcript: "世界",
    })
  );

  assert.equal(partials.at(-1)?.fullText, "你好世界");
  assert.equal(finals.at(-1), "你好世界");
});

test("Bailian realtime preserves the provider text and stash split for direct live preview rendering", async () => {
  const QwenRealtimeStreaming = await loadQwenRealtimeStreaming();
  const streaming = new QwenRealtimeStreaming();
  const partials = [];

  streaming.currentLanguage = "zh";
  streaming.accumulatedText = "你好";
  streaming.onPartialTranscript = (payload) => partials.push(payload);

  streaming.handleMessage(
    JSON.stringify({
      type: "conversation.item.input_audio_transcription.text",
      item_id: "turn-2",
      language: "zh",
      text: "世界",
      stash: "和平",
    })
  );

  assert.deepEqual(partials.at(-1), {
    stableText: "你好世界",
    activeText: "和平",
    fullText: "你好世界和平",
    itemId: "turn-2",
    language: "zh",
  });
});

test("Bailian realtime graceful disconnect flushes in-flight live text via session.finish", async () => {
  const QwenRealtimeStreaming = await loadQwenRealtimeStreaming();
  const streaming = new QwenRealtimeStreaming();
  const sentEvents = [];

  streaming.ws = {
    readyState: 1,
    send(payload) {
      const event = JSON.parse(payload);
      sentEvents.push(event);

      if (event.type === "session.finish") {
        queueMicrotask(() => {
          streaming.handleMessage(JSON.stringify({ type: "session.finished" }));
        });
      }
    },
    removeAllListeners() {},
    close() {},
    terminate() {},
  };
  streaming.sessionConfigured = true;
  streaming.liveText = "你好";

  const result = await streaming.disconnect(true);

  assert.equal(
    sentEvents.some((event) => event.type === "session.finish"),
    true
  );
  assert.equal(
    sentEvents.some((event) => event.type === "input_audio_buffer.commit"),
    false
  );
  assert.equal(result.text, "你好");
});

test("Bailian realtime disconnect keeps completed and in-flight Chinese segments together", async () => {
  const QwenRealtimeStreaming = await loadQwenRealtimeStreaming();
  const streaming = new QwenRealtimeStreaming();
  const sentEvents = [];

  streaming.currentLanguage = "zh";
  streaming.ws = {
    readyState: 1,
    send(payload) {
      const event = JSON.parse(payload);
      sentEvents.push(event);

      if (event.type === "session.finish") {
        queueMicrotask(() => {
          streaming.handleMessage(JSON.stringify({ type: "session.finished" }));
        });
      }
    },
    removeAllListeners() {},
    close() {},
    terminate() {},
  };
  streaming.sessionConfigured = true;
  streaming.accumulatedText = "你好";
  streaming.liveText = "世界";

  const result = await streaming.disconnect(true);

  assert.equal(
    sentEvents.some((event) => event.type === "session.finish"),
    true
  );
  assert.equal(result.text, "你好世界");
});
