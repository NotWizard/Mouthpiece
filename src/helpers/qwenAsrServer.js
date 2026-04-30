const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const { spawn } = require("child_process");
const debugLogger = require("./debugLogger");
const { getCacheDir } = require("./modelDirUtils");
const { getFFmpegPath, isWavFormat, convertToWav } = require("./ffmpegUtils");
const { getSafeTempDir } = require("./safeTempDir");
const { findAvailablePort, gracefulStopProcess } = require("../utils/serverUtils");

const modelRegistryData = require("../models/modelRegistryData.json");

const PORT_RANGE_START = 6030;
const PORT_RANGE_END = 6059;
const STARTUP_TIMEOUT_MS = 120000;
const HEALTH_CHECK_INTERVAL_MS = 5000;
const TRANSCRIPTION_TIMEOUT_MS = 300000;
const QWEN_ASR_MODELS_DIRNAME = "qwen-asr-models";

function getQwenAsrModelConfig(modelName) {
  return modelRegistryData.qwenAsrModels?.[modelName] || null;
}

function buildMultipartBody(fileBuffer, fileName, contentType, fields = {}) {
  const boundary = `----MouthpieceQwenAsr${Date.now()}`;
  const parts = [];

  parts.push(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${fileName}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`
  );
  parts.push(fileBuffer);
  parts.push("\r\n");

  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      parts.push(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
          `${value}\r\n`
      );
    }
  }

  parts.push(`--${boundary}--\r\n`);
  return {
    body: Buffer.concat(parts.map((part) => (typeof part === "string" ? Buffer.from(part) : part))),
    boundary,
  };
}

function requestText(url, options = {}, body = null, timeoutMs = TRANSCRIPTION_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          statusText: res.statusMessage,
          text: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`));
    });
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

class QwenAsrServerManager {
  constructor() {
    this.process = null;
    this.port = null;
    this.ready = false;
    this.modelName = null;
    this.apiKey = null;
    this.startupPromise = null;
    this.healthCheckInterval = null;
    this.executablePath = null;
  }

  getRuntimeDir() {
    return path.join(getCacheDir(), "qwen-asr-runtime");
  }

  getModelsDir() {
    return path.join(getCacheDir(), QWEN_ASR_MODELS_DIRNAME);
  }

  getPythonPath() {
    const binary = process.platform === "win32" ? "python.exe" : "python";
    const subdir = process.platform === "win32" ? "Scripts" : "bin";
    return path.join(this.getRuntimeDir(), subdir, binary);
  }

  getExecutablePath() {
    const binary = process.platform === "win32" ? "mlx-qwen3-asr.exe" : "mlx-qwen3-asr";
    const subdir = process.platform === "win32" ? "Scripts" : "bin";
    const candidate = path.join(this.getRuntimeDir(), subdir, binary);
    return fs.existsSync(candidate) ? candidate : null;
  }

  isSupportedPlatform() {
    return process.platform === "darwin" && process.arch === "arm64";
  }

  isAvailable() {
    return this.isSupportedPlatform() && Boolean(this.getExecutablePath());
  }

  getModelConfig(modelName) {
    const config = getQwenAsrModelConfig(modelName);
    if (!config) {
      throw new Error(`Invalid Qwen ASR model: ${modelName}`);
    }
    return config;
  }

  getModelCacheDir(modelName) {
    const config = this.getModelConfig(modelName);
    return path.join(this.getModelsDir(), "hub", `models--${config.hfModelId.replace("/", "--")}`);
  }

  isModelDownloaded(modelName) {
    const markerPath = path.join(this.getModelsDir(), ".mouthpiece", `${modelName}.json`);
    return fs.existsSync(markerPath) || fs.existsSync(this.getModelCacheDir(modelName));
  }

  buildServerEnv() {
    const modelsDir = this.getModelsDir();
    return {
      ...process.env,
      HF_HOME: modelsDir,
      HF_HUB_CACHE: path.join(modelsDir, "hub"),
      HUGGINGFACE_HUB_CACHE: path.join(modelsDir, "hub"),
      TRANSFORMERS_CACHE: path.join(modelsDir, "transformers"),
      TOKENIZERS_PARALLELISM: "false",
    };
  }

  async ensureWav(audioBuffer) {
    if (isWavFormat(audioBuffer)) return { wavBuffer: audioBuffer, filesToCleanup: [] };

    const ffmpegPath = getFFmpegPath();
    if (!ffmpegPath) {
      throw new Error("FFmpeg not found - required for audio conversion");
    }

    const tempDir = getSafeTempDir();
    const timestamp = Date.now();
    const tempInputPath = path.join(tempDir, `qwen-asr-input-${timestamp}.webm`);
    const tempWavPath = path.join(tempDir, `qwen-asr-${timestamp}.wav`);
    fs.writeFileSync(tempInputPath, audioBuffer);
    await convertToWav(tempInputPath, tempWavPath, { sampleRate: 16000, channels: 1 });
    return {
      wavBuffer: fs.readFileSync(tempWavPath),
      filesToCleanup: [tempInputPath, tempWavPath],
    };
  }

  async startServer(modelName = "qwen3-asr-0.6b-mlx") {
    if (this.startupPromise) return this.startupPromise;
    if (this.ready && this.process && this.modelName === modelName) {
      return { success: true, port: this.port };
    }
    if (this.process) await this.stopServer();

    this.startupPromise = this._doStartServer(modelName);
    try {
      return await this.startupPromise;
    } finally {
      this.startupPromise = null;
    }
  }

  async _doStartServer(modelName) {
    if (!this.isSupportedPlatform()) {
      return { success: false, reason: "Qwen ASR MLX requires Apple Silicon macOS" };
    }

    const executable = this.getExecutablePath();
    if (!executable) {
      return { success: false, reason: "mlx-qwen3-asr runtime is not installed" };
    }

    if (!this.isModelDownloaded(modelName)) {
      return { success: false, reason: `Model "${modelName}" not downloaded` };
    }

    const config = this.getModelConfig(modelName);
    await fs.promises.mkdir(this.getModelsDir(), { recursive: true });

    this.port = await findAvailablePort(PORT_RANGE_START, PORT_RANGE_END);
    this.apiKey = crypto.randomBytes(24).toString("hex");
    this.modelName = modelName;
    this.executablePath = executable;

    const args = [
      "serve",
      "--host",
      "127.0.0.1",
      "--port",
      String(this.port),
      "--api-key",
      this.apiKey,
      "--model",
      config.hfModelId,
    ];

    debugLogger.info("Starting Qwen ASR MLX server", {
      executable,
      modelName,
      hfModelId: config.hfModelId,
      port: this.port,
    });

    this.process = spawn(executable, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      cwd: getSafeTempDir(),
      env: this.buildServerEnv(),
    });

    let stderrBuffer = "";
    let stdoutBuffer = "";

    this.process.stdout.on("data", (data) => {
      stdoutBuffer += data.toString();
      debugLogger.debug("mlx-qwen3-asr stdout", { data: data.toString().trim() });
    });

    this.process.stderr.on("data", (data) => {
      stderrBuffer += data.toString();
      debugLogger.debug("mlx-qwen3-asr stderr", { data: data.toString().trim() });
    });

    this.process.on("error", (error) => {
      debugLogger.error("mlx-qwen3-asr process error", { error: error.message });
      this.ready = false;
    });

    this.process.on("close", (code) => {
      debugLogger.debug("mlx-qwen3-asr process exited", { code });
      this.ready = false;
      this.process = null;
      this.stopHealthCheck();
    });

    await this.waitForHealth(() => ({ stderr: stderrBuffer, stdout: stdoutBuffer }));
    this.startHealthCheck();

    return { success: true, port: this.port };
  }

  async waitForHealth(getProcessInfo) {
    const start = Date.now();
    while (Date.now() - start < STARTUP_TIMEOUT_MS) {
      if (!this.process) {
        const info = getProcessInfo?.() || {};
        const details = (info.stderr || info.stdout || "").trim().slice(-500);
        throw new Error(`mlx-qwen3-asr exited during startup${details ? `: ${details}` : ""}`);
      }

      try {
        if (await this.probeHealth()) {
          this.ready = true;
          return;
        }
      } catch {
        // Server is still starting.
      }

      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const info = getProcessInfo?.() || {};
    const details = (info.stderr || info.stdout || "").trim().slice(-500);
    throw new Error(
      `mlx-qwen3-asr failed to become healthy within ${STARTUP_TIMEOUT_MS}ms${
        details ? `: ${details}` : ""
      }`
    );
  }

  async probeHealth() {
    const health = await requestText(
      `http://127.0.0.1:${this.port}/health`,
      { method: "GET" },
      null,
      2000
    ).catch(() => null);
    if (health?.ok) return true;

    const models = await requestText(
      `http://127.0.0.1:${this.port}/v1/models`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
      },
      null,
      2000
    ).catch(() => null);
    return Boolean(models?.ok);
  }

  startHealthCheck() {
    this.stopHealthCheck();
    this.healthCheckInterval = setInterval(async () => {
      if (!this.process) {
        this.ready = false;
        this.stopHealthCheck();
        return;
      }

      try {
        this.ready = await this.probeHealth();
      } catch {
        this.ready = false;
      }
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  stopHealthCheck() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
  }

  async transcribe(audioBuffer, options = {}) {
    const modelName = options.modelName || options.model || this.modelName || "qwen3-asr-0.6b-mlx";
    const config = this.getModelConfig(modelName);

    if (!this.ready || !this.process || this.modelName !== modelName) {
      const startResult = await this.startServer(modelName);
      if (!startResult?.success) {
        throw new Error(startResult?.reason || "Failed to start Qwen ASR server");
      }
    }

    const { wavBuffer, filesToCleanup } = await this.ensureWav(audioBuffer);
    try {
      const fields = {
        model: config.hfModelId,
        response_format: "json",
      };
      if (options.language && options.language !== "auto") fields.language = options.language;
      if (options.prompt) fields.prompt = options.prompt;
      if (options.context) fields.context = options.context;

      const { body, boundary } = buildMultipartBody(wavBuffer, "audio.wav", "audio/wav", fields);

      const response = await requestText(
        `http://127.0.0.1:${this.port}/v1/audio/transcriptions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": `multipart/form-data; boundary=${boundary}`,
            "Content-Length": body.length,
          },
        },
        body
      );

      if (!response.ok) {
        throw new Error(`Qwen ASR API error ${response.status}: ${response.text}`);
      }

      try {
        const parsed = JSON.parse(response.text);
        return { text: (parsed.text || "").trim(), raw: parsed };
      } catch {
        return { text: response.text.trim(), raw: response.text };
      }
    } finally {
      for (const filePath of filesToCleanup) {
        try {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (error) {
          debugLogger.warn("Failed to cleanup Qwen ASR temp file", {
            path: filePath,
            error: error.message,
          });
        }
      }
    }
  }

  async stopServer() {
    this.stopHealthCheck();
    if (!this.process) {
      this.ready = false;
      this.port = null;
      this.modelName = null;
      return;
    }

    try {
      await gracefulStopProcess(this.process);
    } catch (error) {
      debugLogger.error("Error stopping Qwen ASR server", { error: error.message });
    }

    this.process = null;
    this.ready = false;
    this.port = null;
    this.modelName = null;
    this.apiKey = null;
  }

  getServerStatus() {
    return {
      available: this.isAvailable(),
      running: Boolean(this.process),
      ready: this.ready,
      port: this.port,
      modelName: this.modelName,
      endpoint: this.port ? `http://127.0.0.1:${this.port}` : null,
    };
  }
}

module.exports = QwenAsrServerManager;
