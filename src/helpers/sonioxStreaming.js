const crypto = require("crypto");
const WebSocket = require("ws");
const debugLogger = require("./debugLogger");
const {
  SONIOX_REALTIME_MODEL,
  buildSonioxRealtimeConfig,
  createInitialSonioxTranscriptState,
  accumulateSonioxTokens,
  hasSonioxFinalizeToken,
} = require("./sonioxShared");

const SONIOX_WEBSOCKET_URL = "wss://stt-rt.soniox.com/transcribe-websocket";
const SAMPLE_RATE = 16000;
const WEBSOCKET_TIMEOUT_MS = 30000;
const TERMINATION_TIMEOUT_MS = 5000;
const KEEPALIVE_INTERVAL_MS = 8000;

class SonioxStreaming {
  constructor() {
    this.ws = null;
    this.sessionId = null;
    this.isConnected = false;
    this.onPartialTranscript = null;
    this.onFinalTranscript = null;
    this.onError = null;
    this.onSessionEnd = null;
    this.currentModel = SONIOX_REALTIME_MODEL;
    this.audioBytesSent = 0;
    this.isDisconnecting = false;
    this.finalizeSent = false;
    this.finalizeObserved = false;
    this.keepAliveInterval = null;
    this.closeResolve = null;
    this.transcriptState = createInitialSonioxTranscriptState();
    this.warmConnection = null;
    this.warmConnectionReady = false;
    this.warmConnectionOptions = null;
  }

  buildRealtimeConfig(options = {}) {
    const config = buildSonioxRealtimeConfig({
      apiKey: options.apiKey,
      model: options.model,
      realtimeEnabled: true,
      sampleRate: options.sampleRate || SAMPLE_RATE,
      numChannels: 1,
      language: options.language,
      keyterms: options.keyterms,
    });

    this.currentModel = config.model || SONIOX_REALTIME_MODEL;
    return config;
  }

  hasWarmConnection() {
    return Boolean(
      this.warmConnection &&
        this.warmConnectionReady &&
        this.warmConnection.readyState === WebSocket.OPEN
    );
  }

  startKeepAlive(target) {
    this.stopKeepAlive();
    this.keepAliveInterval = setInterval(() => {
      if (!target || target.readyState !== WebSocket.OPEN) {
        this.stopKeepAlive();
        return;
      }

      try {
        target.send(JSON.stringify({ type: "keepalive" }));
      } catch (error) {
        debugLogger.debug("Soniox keepalive failed", { error: error.message }, "streaming");
      }
    }, KEEPALIVE_INTERVAL_MS);
  }

  stopKeepAlive() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }

  resetTranscriptState() {
    this.transcriptState = createInitialSonioxTranscriptState();
    this.finalizeObserved = false;
    this.finalizeSent = false;
    this.audioBytesSent = 0;
  }

  async warmup(options = {}) {
    if (!options.apiKey) {
      throw new Error("Soniox API key is required for realtime warmup");
    }

    if (this.hasWarmConnection()) {
      return;
    }

    if (this.warmConnection && !this.warmConnectionReady) {
      return;
    }

    this.warmConnectionOptions = { ...options };
    const config = this.buildRealtimeConfig(options);

    return new Promise((resolve, reject) => {
      const socket = new WebSocket(SONIOX_WEBSOCKET_URL);
      let settled = false;
      const timeoutId = setTimeout(() => {
        try {
          socket.terminate();
        } catch {}
        reject(new Error("Soniox realtime warmup timed out"));
      }, WEBSOCKET_TIMEOUT_MS);

      const finishReject = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        reject(error);
      };

      socket.on("open", () => {
        try {
          socket.send(JSON.stringify(config));
          this.warmConnection = socket;
          this.warmConnectionReady = true;
          this.startKeepAlive(socket);
          if (!settled) {
            settled = true;
            clearTimeout(timeoutId);
            resolve();
          }
        } catch (error) {
          finishReject(error);
        }
      });

      socket.on("error", (error) => {
        this.cleanupWarmConnection();
        finishReject(error);
      });

      socket.on("close", () => {
        this.cleanupWarmConnection();
      });
    });
  }

  cleanupWarmConnection() {
    this.stopKeepAlive();
    if (this.warmConnection) {
      try {
        this.warmConnection.removeAllListeners();
      } catch {}
    }
    this.warmConnection = null;
    this.warmConnectionReady = false;
  }

  useWarmConnection() {
    if (!this.hasWarmConnection()) {
      this.cleanupWarmConnection();
      return false;
    }

    const socket = this.warmConnection;
    this.cleanupWarmConnection();
    this.attachActiveSocket(socket);
    this.isConnected = true;
    this.sessionId = crypto.randomUUID?.() || `soniox-${Date.now()}`;
    return true;
  }

  attachActiveSocket(socket) {
    if (!socket) return;

    socket.removeAllListeners("message");
    socket.on("message", (data, isBinary) => {
      this.handleMessage(data, isBinary);
    });

    socket.removeAllListeners("error");
    socket.on("error", (error) => {
      debugLogger.error("Soniox realtime WebSocket error", { error: error.message }, "streaming");
      if (!this.isDisconnecting) {
        this.onError?.(error);
      }
    });

    socket.removeAllListeners("close");
    socket.on("close", (code, reason) => {
      const finalText = this.transcriptState.finalText || this.transcriptState.liveText || "";
      const payload = { code, reason: reason?.toString(), text: finalText };
      debugLogger.debug("Soniox realtime WebSocket closed", payload, "streaming");

      const wasActive = this.isConnected;
      this.ws = null;
      this.isConnected = false;
      this.sessionId = null;

      if (wasActive) {
        this.onSessionEnd?.({ text: finalText, code, reason: reason?.toString() });
      }

      if (this.closeResolve) {
        const resolve = this.closeResolve;
        this.closeResolve = null;
        resolve({
          text: finalText,
          model: this.currentModel,
          audioBytesSent: this.audioBytesSent,
        });
      } else if (!this.isDisconnecting && wasActive) {
        this.onError?.(new Error(`Connection lost (code: ${code})`));
      }

      this.isDisconnecting = false;
      this.stopKeepAlive();
    });

    this.ws = socket;
  }

  async connect(options = {}) {
    if (!options.apiKey) {
      throw new Error("Soniox API key is required for realtime transcription");
    }

    this.resetTranscriptState();

    if (this.useWarmConnection()) {
      return;
    }

    const config = this.buildRealtimeConfig(options);

    return new Promise((resolve, reject) => {
      const socket = new WebSocket(SONIOX_WEBSOCKET_URL);
      const timeoutId = setTimeout(() => {
        try {
          socket.terminate();
        } catch {}
        reject(new Error("Soniox realtime connection timed out"));
      }, WEBSOCKET_TIMEOUT_MS);

      socket.on("open", () => {
        try {
          this.attachActiveSocket(socket);
          socket.send(JSON.stringify(config));
          this.isConnected = true;
          this.sessionId = crypto.randomUUID?.() || `soniox-${Date.now()}`;
          clearTimeout(timeoutId);
          resolve();
        } catch (error) {
          clearTimeout(timeoutId);
          reject(error);
        }
      });

      socket.on("error", (error) => {
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  handleMessage(data, isBinary = false) {
    if (isBinary) {
      return;
    }

    let payload;
    try {
      payload = JSON.parse(data.toString());
    } catch (error) {
      debugLogger.debug(
        "Ignoring non-JSON Soniox realtime message",
        { error: error.message },
        "streaming"
      );
      return;
    }

    if (payload?.error) {
      const error = new Error(payload.error?.message || payload.error || "Soniox realtime error");
      this.onError?.(error);
      return;
    }

    if (!Array.isArray(payload?.tokens) || payload.tokens.length === 0) {
      return;
    }

    const previousFinalText = this.transcriptState.finalText;
    this.transcriptState = accumulateSonioxTokens(this.transcriptState, payload.tokens);
    this.finalizeObserved =
      this.finalizeObserved ||
      this.transcriptState.sawFin ||
      hasSonioxFinalizeToken(payload.tokens);

    if (this.transcriptState.liveText) {
      this.onPartialTranscript?.(this.transcriptState.liveText);
    }

    if (this.transcriptState.finalText && this.transcriptState.finalText !== previousFinalText) {
      this.onFinalTranscript?.(this.transcriptState.finalText);
    }
  }

  sendAudio(audioBuffer) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.audioBytesSent += audioBuffer.length;
    this.ws.send(audioBuffer);
  }

  finalize() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.finalizeSent) {
      return;
    }

    this.finalizeSent = true;
    this.ws.send(JSON.stringify({ type: "finalize" }));
  }

  async disconnect(graceful = true) {
    if (!this.ws) {
      return {
        text: this.transcriptState.finalText || this.transcriptState.liveText || "",
        model: this.currentModel,
        audioBytesSent: this.audioBytesSent,
      };
    }

    this.isDisconnecting = true;
    const socket = this.ws;

    if (!graceful) {
      try {
        socket.close();
      } catch {}
      return {
        text: this.transcriptState.finalText || this.transcriptState.liveText || "",
        model: this.currentModel,
        audioBytesSent: this.audioBytesSent,
      };
    }

    return new Promise((resolve) => {
      const timeoutId = setTimeout(() => {
        try {
          socket.terminate();
        } catch {}
        this.closeResolve = null;
        this.isDisconnecting = false;
        resolve({
          text: this.transcriptState.finalText || this.transcriptState.liveText || "",
          model: this.currentModel,
          audioBytesSent: this.audioBytesSent,
        });
      }, TERMINATION_TIMEOUT_MS);

      this.closeResolve = (result) => {
        clearTimeout(timeoutId);
        resolve(result);
      };

      try {
        if (!this.finalizeSent) {
          this.finalize();
        }
        socket.send(Buffer.alloc(0));
      } catch (error) {
        clearTimeout(timeoutId);
        this.closeResolve = null;
        this.isDisconnecting = false;
        resolve({
          text: this.transcriptState.finalText || this.transcriptState.liveText || "",
          model: this.currentModel,
          audioBytesSent: this.audioBytesSent,
          error: error.message,
        });
      }
    });
  }

  getStatus() {
    return {
      isConnected: this.isConnected,
      sessionId: this.sessionId,
    };
  }
}

module.exports = SonioxStreaming;
