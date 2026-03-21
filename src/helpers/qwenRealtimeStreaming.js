const crypto = require("crypto");
const WebSocket = require("ws");
const debugLogger = require("./debugLogger");

const QWEN_REALTIME_MODEL = "qwen3-asr-flash-realtime";
// China mainland endpoint only for now. Regional routing can be added later if
// provider-region settings are introduced for Bailian.
const QWEN_REALTIME_URL =
  "wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3-asr-flash-realtime";
const SAMPLE_RATE = 16000;
const WEBSOCKET_TIMEOUT_MS = 30000;
const TERMINATION_TIMEOUT_MS = 5000;
const PENDING_AUDIO_BUFFER_MAX = 3 * SAMPLE_RATE * 2;
const QWEN_REALTIME_TURN_DETECTION = Object.freeze({
  type: "server_vad",
  threshold: 0,
  silence_duration_ms: 400,
});
const CJK_CHARACTER_RE = /[\u3400-\u9FFF\uF900-\uFAFF\u3040-\u30FF]/u;
const NO_SPACE_BEFORE_RE = /[),.?!%:;}\]，。！？、；：）》」』】]/u;
const NO_SPACE_AFTER_RE = /[(\[{“‘《「『【]/u;

function getFirstCharacter(text) {
  const characters = Array.from(typeof text === "string" ? text.trim() : "");
  return characters[0] || "";
}

function getLastCharacter(text) {
  const characters = Array.from(typeof text === "string" ? text.trim() : "");
  return characters[characters.length - 1] || "";
}

function shouldUseCompactCjkJoin(language) {
  return typeof language === "string" && /^(zh|ja)(-|$)/i.test(language.trim());
}

function joinTranscriptSegments(leftText, rightText, { language } = {}) {
  const left = typeof leftText === "string" ? leftText.trim() : "";
  const right = typeof rightText === "string" ? rightText.trim() : "";

  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  const leftLast = getLastCharacter(left);
  const rightFirst = getFirstCharacter(right);
  const shouldOmitSpace =
    NO_SPACE_AFTER_RE.test(leftLast) ||
    NO_SPACE_BEFORE_RE.test(rightFirst) ||
    (CJK_CHARACTER_RE.test(leftLast) && CJK_CHARACTER_RE.test(rightFirst)) ||
    (shouldUseCompactCjkJoin(language) &&
      (CJK_CHARACTER_RE.test(leftLast) || CJK_CHARACTER_RE.test(rightFirst)));

  return shouldOmitSpace ? `${left}${right}` : `${left} ${right}`;
}

class QwenRealtimeStreaming {
  constructor() {
    this.ws = null;
    this.warmConnection = null;
    this.warmConnectionReady = false;
    this.warmConnectionOptions = null;
    this.warmSessionId = null;
    this.sessionConfigured = false;
    this.sessionId = null;
    this.isConnected = false;
    this.isDisconnecting = false;
    this.finalizeSent = false;
    this.finishSent = false;
    this.closeResolve = null;
    this.onPartialTranscript = null;
    this.onFinalTranscript = null;
    this.onError = null;
    this.onSpeechStarted = null;
    this.onSessionEnd = null;
    this.currentModel = QWEN_REALTIME_MODEL;
    this.currentLanguage = null;
    this.audioBytesSent = 0;
    this.accumulatedText = "";
    this.liveText = "";
    this.completedItemIds = new Set();
    this.pendingAudioBuffers = [];
    this.pendingAudioBytes = 0;
    this.sessionEndEmitted = false;
  }

  createEventId(prefix = "event") {
    return (
      crypto.randomUUID?.() || `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    );
  }

  normalizeOptions(options = {}) {
    return {
      apiKey: options.apiKey,
      model: options.model || QWEN_REALTIME_MODEL,
      sampleRate: options.sampleRate || SAMPLE_RATE,
      language:
        typeof options.language === "string" &&
        options.language.trim() &&
        options.language !== "auto"
          ? options.language.trim()
          : undefined,
    };
  }

  optionsMatch(left = {}, right = {}) {
    const a = this.normalizeOptions(left);
    const b = this.normalizeOptions(right);
    return (
      a.model === b.model &&
      a.sampleRate === b.sampleRate &&
      (a.language || "") === (b.language || "") &&
      (a.apiKey || "") === (b.apiKey || "")
    );
  }

  hasWarmConnection() {
    return Boolean(
      this.warmConnection &&
      this.warmConnectionReady &&
      this.warmConnection.readyState === WebSocket.OPEN
    );
  }

  buildSessionUpdateEvent(options = {}) {
    const normalized = this.normalizeOptions(options);
    const inputAudioTranscription = {};

    if (normalized.language) {
      inputAudioTranscription.language = normalized.language;
    }

    return {
      event_id: this.createEventId(),
      type: "session.update",
      session: {
        input_audio_format: "pcm",
        sample_rate: normalized.sampleRate,
        input_audio_transcription: inputAudioTranscription,
        // Keep server VAD enabled so Bailian emits partial transcripts while audio
        // is still flowing. Manual mode only starts recognition after commit.
        turn_detection: QWEN_REALTIME_TURN_DETECTION,
      },
    };
  }

  buildAppendEvent(audioBuffer) {
    return {
      event_id: this.createEventId(),
      type: "input_audio_buffer.append",
      audio: audioBuffer.toString("base64"),
    };
  }

  parseMessage(data) {
    try {
      return JSON.parse(data.toString());
    } catch (error) {
      debugLogger.debug(
        "Ignoring non-JSON Bailian realtime message",
        { error: error.message },
        "streaming"
      );
      return null;
    }
  }

  createProtocolError(payload, fallbackMessage) {
    const message =
      payload?.error?.message ||
      payload?.error?.code ||
      payload?.message ||
      fallbackMessage ||
      "Alibaba Bailian realtime error";
    const error = new Error(message);
    if (payload?.error?.code) {
      error.code = payload.error.code;
    }
    if (payload?.error?.param) {
      error.param = payload.error.param;
    }
    return error;
  }

  getResolvedText() {
    return joinTranscriptSegments(this.accumulatedText, this.liveText, {
      language: this.currentLanguage,
    });
  }

  buildResult() {
    return {
      text: this.getResolvedText(),
      model: this.currentModel || QWEN_REALTIME_MODEL,
      audioBytesSent: this.audioBytesSent,
    };
  }

  emitSessionEndOnce(data = {}) {
    if (this.sessionEndEmitted) {
      return;
    }

    this.sessionEndEmitted = true;
    this.onSessionEnd?.(data);
  }

  resetTranscriptState() {
    this.sessionConfigured = false;
    this.finalizeSent = false;
    this.finishSent = false;
    this.currentLanguage = null;
    this.audioBytesSent = 0;
    this.accumulatedText = "";
    this.liveText = "";
    this.completedItemIds = new Set();
    this.pendingAudioBuffers = [];
    this.pendingAudioBytes = 0;
    this.sessionEndEmitted = false;
  }

  clearPendingAudio() {
    this.pendingAudioBuffers = [];
    this.pendingAudioBytes = 0;
  }

  cleanupWarmConnection({ closeSocket = true, terminate = false } = {}) {
    const socket = this.warmConnection;
    if (socket) {
      try {
        socket.removeAllListeners();
      } catch {}
      try {
        if (terminate) {
          socket.terminate();
        } else if (closeSocket && socket.readyState === WebSocket.OPEN) {
          socket.close();
        }
      } catch {}
    }

    this.warmConnection = null;
    this.warmConnectionReady = false;
    this.warmConnectionOptions = null;
    this.warmSessionId = null;
  }

  cleanupActiveConnection({ closeSocket = true, terminate = false } = {}) {
    const socket = this.ws;
    if (socket) {
      try {
        socket.removeAllListeners();
      } catch {}
      try {
        if (terminate) {
          socket.terminate();
        } else if (closeSocket && socket.readyState === WebSocket.OPEN) {
          socket.close();
        }
      } catch {}
    }

    this.ws = null;
    this.isConnected = false;
    this.sessionConfigured = false;
    this.sessionId = null;
  }

  attachWarmConnection(socket, options, sessionId, model) {
    this.cleanupWarmConnection({ closeSocket: false });

    this.warmConnection = socket;
    this.warmConnectionReady = true;
    this.warmConnectionOptions = this.normalizeOptions(options);
    this.warmSessionId = sessionId || null;
    this.currentModel = model || QWEN_REALTIME_MODEL;

    socket.removeAllListeners("message");
    socket.removeAllListeners("error");
    socket.removeAllListeners("close");

    socket.on("error", (error) => {
      debugLogger.debug(
        "Bailian realtime warm connection error",
        { error: error.message },
        "streaming"
      );
      if (this.warmConnection === socket) {
        this.cleanupWarmConnection({ closeSocket: false });
      }
    });

    socket.on("close", () => {
      if (this.warmConnection === socket) {
        this.cleanupWarmConnection({ closeSocket: false });
      }
    });
  }

  attachActiveSocket(socket) {
    if (!socket) {
      return;
    }

    socket.removeAllListeners("message");
    socket.removeAllListeners("error");
    socket.removeAllListeners("close");

    socket.on("message", (data) => {
      this.handleMessage(data);
    });

    socket.on("error", (error) => {
      debugLogger.error("Bailian realtime WebSocket error", { error: error.message }, "streaming");
      if (!this.isDisconnecting) {
        this.onError?.(error);
      }
    });

    socket.on("close", (code, reason) => {
      const wasActive = this.ws === socket || this.isConnected;
      const result = this.buildResult();
      const closeData = {
        text: result.text,
        code,
        reason: reason?.toString(),
      };
      const resolve = this.closeResolve;
      const shouldError = wasActive && !this.isDisconnecting && !this.closeResolve;

      this.closeResolve = null;
      this.cleanupActiveConnection({ closeSocket: false });
      this.isDisconnecting = false;

      if (wasActive) {
        this.emitSessionEndOnce(closeData);
      }

      if (resolve) {
        resolve(result);
      } else if (shouldError) {
        this.onError?.(new Error(`Connection lost (code: ${code})`));
      }
    });

    this.ws = socket;
    this.isConnected = true;
    this.sessionConfigured = true;
  }

  flushPendingAudio() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.sessionConfigured) {
      return;
    }

    for (const bufferedAudio of this.pendingAudioBuffers) {
      this.sendAudio(bufferedAudio);
    }
    this.clearPendingAudio();
  }

  useWarmConnection(options = {}) {
    if (!this.hasWarmConnection() || !this.optionsMatch(options, this.warmConnectionOptions)) {
      if (this.hasWarmConnection() && !this.optionsMatch(options, this.warmConnectionOptions)) {
        this.cleanupWarmConnection({ terminate: true });
      }
      return false;
    }

    const socket = this.warmConnection;
    const sessionId = this.warmSessionId;
    const model = this.warmConnectionOptions?.model || QWEN_REALTIME_MODEL;
    const language = this.warmConnectionOptions?.language || null;

    this.warmConnection = null;
    this.warmConnectionReady = false;
    this.warmConnectionOptions = null;
    this.warmSessionId = null;

    this.attachActiveSocket(socket);
    this.sessionId = sessionId || null;
    this.currentModel = model;
    this.currentLanguage = language;
    this.flushPendingAudio();
    return true;
  }

  async createConfiguredSocket(options = {}) {
    const normalized = this.normalizeOptions(options);
    const { apiKey } = normalized;

    if (!apiKey) {
      throw new Error("Alibaba Bailian API key is required for realtime transcription");
    }

    const socket = new WebSocket(QWEN_REALTIME_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    return new Promise((resolve, reject) => {
      let settled = false;
      let sessionId = null;
      const timeoutId = setTimeout(() => {
        try {
          socket.terminate();
        } catch {}
        reject(new Error("Alibaba Bailian realtime connection timed out"));
      }, WEBSOCKET_TIMEOUT_MS);

      const cleanup = () => {
        clearTimeout(timeoutId);
        socket.removeListener("message", handleMessage);
        socket.removeListener("error", handleError);
        socket.removeListener("close", handleClose);
      };

      const finishReject = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      };

      const handleError = (error) => {
        finishReject(error);
      };

      const handleClose = (code) => {
        finishReject(new Error(`Alibaba Bailian realtime closed before ready (code: ${code})`));
      };

      const handleMessage = (data) => {
        const payload = this.parseMessage(data);
        if (!payload) {
          return;
        }

        if (payload.type === "session.created") {
          sessionId = payload?.session?.id || sessionId;

          try {
            socket.send(JSON.stringify(this.buildSessionUpdateEvent(normalized)));
          } catch (error) {
            finishReject(error);
          }
          return;
        }

        if (payload.type === "session.updated") {
          if (settled) {
            return;
          }

          settled = true;
          cleanup();
          resolve({
            socket,
            sessionId: payload?.session?.id || sessionId,
            model: payload?.session?.model || normalized.model,
          });
          return;
        }

        if (payload.type === "error") {
          finishReject(
            this.createProtocolError(payload, "Alibaba Bailian realtime configuration failed")
          );
        }
      };

      socket.on("message", handleMessage);
      socket.on("error", handleError);
      socket.on("close", handleClose);
    });
  }

  async warmup(options = {}) {
    const normalized = this.normalizeOptions(options);
    if (!normalized.apiKey) {
      throw new Error("Alibaba Bailian API key is required for realtime warmup");
    }

    if (this.hasWarmConnection() && this.optionsMatch(normalized, this.warmConnectionOptions)) {
      return;
    }

    if (this.warmConnection && !this.warmConnectionReady) {
      return;
    }

    if (this.hasWarmConnection() && !this.optionsMatch(normalized, this.warmConnectionOptions)) {
      this.cleanupWarmConnection({ terminate: true });
    }

    const { socket, sessionId, model } = await this.createConfiguredSocket(normalized);
    this.attachWarmConnection(socket, normalized, sessionId, model);
  }

  async connect(options = {}) {
    const normalized = this.normalizeOptions(options);
    if (!normalized.apiKey) {
      throw new Error("Alibaba Bailian API key is required for realtime transcription");
    }

    this.resetTranscriptState();
    this.currentLanguage = normalized.language || null;
    this.isDisconnecting = false;

    if (this.useWarmConnection(normalized)) {
      return;
    }

    const { socket, sessionId, model } = await this.createConfiguredSocket(normalized);
    this.attachActiveSocket(socket);
    this.sessionId = sessionId || null;
    this.currentModel = model || normalized.model;
    this.flushPendingAudio();
  }

  appendPendingAudio(audioBuffer) {
    const copy = Buffer.from(audioBuffer);
    this.pendingAudioBuffers.push(copy);
    this.pendingAudioBytes += copy.length;

    while (
      this.pendingAudioBuffers.length > 0 &&
      this.pendingAudioBytes > PENDING_AUDIO_BUFFER_MAX
    ) {
      const removed = this.pendingAudioBuffers.shift();
      this.pendingAudioBytes -= removed?.length || 0;
    }
  }

  sendAudio(audioBuffer) {
    if (!audioBuffer) {
      return false;
    }

    const normalizedBuffer = Buffer.isBuffer(audioBuffer) ? audioBuffer : Buffer.from(audioBuffer);

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.sessionConfigured) {
      if (
        this.ws &&
        (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)
      ) {
        this.appendPendingAudio(normalizedBuffer);
      }
      return false;
    }

    this.audioBytesSent += normalizedBuffer.length;
    this.ws.send(JSON.stringify(this.buildAppendEvent(normalizedBuffer)));
    return true;
  }

  appendCompletedTranscript(itemId, transcript) {
    const trimmedTranscript = typeof transcript === "string" ? transcript.trim() : "";
    if (!trimmedTranscript) {
      return;
    }

    if (itemId && this.completedItemIds.has(itemId)) {
      return;
    }

    if (itemId) {
      this.completedItemIds.add(itemId);
    }

    this.accumulatedText = joinTranscriptSegments(this.accumulatedText, trimmedTranscript, {
      language: this.currentLanguage,
    });
  }

  buildPartialTranscriptPayload({ itemId = null, language = null, text = "", stash = "" } = {}) {
    const stableCurrentText = typeof text === "string" ? text : "";
    const activeCurrentText = typeof stash === "string" ? stash : "";
    const currentPreviewText = `${stableCurrentText}${activeCurrentText}`;
    const stablePreviewText = joinTranscriptSegments(this.accumulatedText, stableCurrentText, {
      language: this.currentLanguage,
    });
    const fullPreviewText = joinTranscriptSegments(this.accumulatedText, currentPreviewText, {
      language: this.currentLanguage,
    });
    const activePreviewText = fullPreviewText.startsWith(stablePreviewText)
      ? fullPreviewText.slice(stablePreviewText.length)
      : activeCurrentText;

    return {
      stableText: stablePreviewText,
      activeText: activePreviewText,
      fullText: fullPreviewText,
      itemId: itemId || null,
      language: language || this.currentLanguage || null,
    };
  }

  handleMessage(data) {
    const payload = this.parseMessage(data);
    if (!payload) {
      return;
    }

    switch (payload.type) {
      case "conversation.item.input_audio_transcription.text": {
        const text = typeof payload.text === "string" ? payload.text : "";
        const stash = typeof payload.stash === "string" ? payload.stash : "";
        const previewText = `${text}${stash}`;
        this.liveText = previewText;

        if (previewText) {
          this.onPartialTranscript?.(
            this.buildPartialTranscriptPayload({
              itemId: payload.item_id || null,
              language: payload.language || null,
              text,
              stash,
            })
          );
        }
        break;
      }

      case "conversation.item.input_audio_transcription.completed": {
        this.liveText = "";
        this.appendCompletedTranscript(payload.item_id, payload.transcript);
        if (this.accumulatedText) {
          this.onFinalTranscript?.(this.accumulatedText);
        }
        break;
      }

      case "input_audio_buffer.speech_started": {
        this.onSpeechStarted?.({
          itemId: payload.item_id || null,
          audioStartMs: Number.isFinite(payload.audio_start_ms) ? payload.audio_start_ms : null,
        });
        break;
      }

      case "conversation.item.input_audio_transcription.failed": {
        const error = this.createProtocolError(
          payload,
          "Alibaba Bailian realtime transcription failed"
        );
        this.onError?.(error);
        break;
      }

      case "session.finished": {
        const result = this.buildResult();
        this.emitSessionEndOnce({ text: result.text });

        const resolve = this.closeResolve;
        this.closeResolve = null;
        this.cleanupActiveConnection({ closeSocket: true });
        this.isDisconnecting = false;

        resolve?.(result);
        break;
      }

      case "error": {
        const error = this.createProtocolError(payload, "Alibaba Bailian realtime error");
        this.onError?.(error);
        break;
      }

      default:
        break;
    }
  }

  finalize() {
    // In server VAD mode the service commits turns automatically and manual
    // input_audio_buffer.commit is disabled.
    if (QWEN_REALTIME_TURN_DETECTION.type === "server_vad") {
      return false;
    }

    if (
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN ||
      !this.sessionConfigured ||
      this.finalizeSent
    ) {
      return false;
    }

    this.finalizeSent = true;
    this.ws.send(
      JSON.stringify({
        event_id: this.createEventId(),
        type: "input_audio_buffer.commit",
      })
    );
    return true;
  }

  finishSession() {
    if (
      !this.ws ||
      this.ws.readyState !== WebSocket.OPEN ||
      !this.sessionConfigured ||
      this.finishSent
    ) {
      return false;
    }

    this.finishSent = true;
    this.ws.send(
      JSON.stringify({
        event_id: this.createEventId(),
        type: "session.finish",
      })
    );
    return true;
  }

  async disconnect(graceful = true) {
    if (!this.ws) {
      return this.buildResult();
    }

    this.isDisconnecting = true;
    const socket = this.ws;

    if (!graceful || socket.readyState !== WebSocket.OPEN || !this.sessionConfigured) {
      const result = this.buildResult();
      this.cleanupActiveConnection({ closeSocket: !graceful });
      this.isDisconnecting = false;
      return result;
    }

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        try {
          socket.terminate();
        } catch {}

        const result = this.buildResult();
        this.closeResolve = null;
        this.cleanupActiveConnection({ closeSocket: false, terminate: true });
        this.isDisconnecting = false;
        resolve(result);
      }, TERMINATION_TIMEOUT_MS);

      this.closeResolve = (result) => {
        clearTimeout(timeoutId);
        resolve(result);
      };

      try {
        if (!this.finalizeSent) {
          this.finalize();
        }
        this.finishSession();
      } catch (error) {
        clearTimeout(timeoutId);
        this.closeResolve = null;

        const result = {
          ...this.buildResult(),
          error: error.message,
        };

        this.cleanupActiveConnection({ closeSocket: false, terminate: true });
        this.isDisconnecting = false;
        resolve(result);
      }
    });
  }

  getStatus() {
    return {
      isConnected: this.isConnected,
      sessionId: this.sessionId,
      hasWarmConnection: this.hasWarmConnection(),
    };
  }
}

module.exports = QwenRealtimeStreaming;
