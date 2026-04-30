const fs = require("fs");
const fsPromises = require("fs").promises;
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const debugLogger = require("./debugLogger");
const QwenAsrServerManager = require("./qwenAsrServer");
const { getCacheDir } = require("./modelDirUtils");
const { killProcess } = require("../utils/process");

const modelRegistryData = require("../models/modelRegistryData.json");

const DEFAULT_MODEL = "qwen3-asr-0.6b-mlx";
const RUNTIME_PACKAGE = "mlx-qwen3-asr[serve]";
const QWEN_ASR_MODELS_DIRNAME = "qwen-asr-models";
const PYTHON_VERSION_PATTERN = /Python\s+(\d+)\.(\d+)\.(\d+)/;

function isSupportedPlatform() {
  return process.platform === "darwin" && process.arch === "arm64";
}

function getValidModelNames() {
  return Object.keys(modelRegistryData.qwenAsrModels || {});
}

function getQwenModelConfig(modelName) {
  return modelRegistryData.qwenAsrModels?.[modelName] || null;
}

function parsePythonVersion(output) {
  const match = String(output || "").match(PYTHON_VERSION_PATTERN);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function isPythonVersionSupported(version) {
  return Boolean(version && (version.major > 3 || (version.major === 3 && version.minor >= 10)));
}

function bytesToMb(bytes) {
  return Math.round((bytes || 0) / (1024 * 1024));
}

async function directorySizeBytes(dirPath) {
  let total = 0;
  try {
    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        total += await directorySizeBytes(entryPath);
      } else {
        const stats = await fsPromises.stat(entryPath).catch(() => null);
        total += stats?.size || 0;
      }
    }
  } catch {}
  return total;
}

class QwenAsrManager {
  constructor() {
    this.currentDownloadProcess = null;
    this.serverManager = new QwenAsrServerManager();
    this.isInitialized = false;
  }

  getRuntimeDir() {
    return path.join(getCacheDir(), "qwen-asr-runtime");
  }

  getModelsDir() {
    return path.join(getCacheDir(), QWEN_ASR_MODELS_DIRNAME);
  }

  getMarkerDir() {
    return path.join(this.getModelsDir(), ".mouthpiece");
  }

  getMarkerPath(modelName) {
    return path.join(this.getMarkerDir(), `${modelName}.json`);
  }

  getPythonPath() {
    return this.serverManager.getPythonPath();
  }

  getExecutablePath() {
    return this.serverManager.getExecutablePath();
  }

  validateModelName(modelName) {
    const validModels = getValidModelNames();
    if (!validModels.includes(modelName)) {
      throw new Error(
        `Invalid Qwen ASR model: ${modelName}. Valid models: ${validModels.join(", ")}`
      );
    }
    return true;
  }

  async initializeAtStartup(settings = {}) {
    const startTime = Date.now();
    this.isInitialized = true;

    try {
      const { localTranscriptionProvider, qwenAsrModel } = settings;
      if (localTranscriptionProvider === "qwen" && qwenAsrModel && isSupportedPlatform()) {
        if (
          this.serverManager.isAvailable() &&
          this.serverManager.isModelDownloaded(qwenAsrModel)
        ) {
          debugLogger.info("Pre-warming Qwen ASR server", { model: qwenAsrModel });
          await this.serverManager.startServer(qwenAsrModel);
        } else {
          debugLogger.debug("Skipping Qwen ASR pre-warm: runtime or model unavailable", {
            model: qwenAsrModel,
            runtimeAvailable: this.serverManager.isAvailable(),
            modelDownloaded: this.serverManager.isModelDownloaded(qwenAsrModel),
          });
        }
      }
    } catch (error) {
      debugLogger.warn("Qwen ASR initialization error", { error: error.message });
    }

    debugLogger.info("Qwen ASR initialization complete", {
      totalTimeMs: Date.now() - startTime,
      supported: isSupportedPlatform(),
      runtimeAvailable: this.serverManager.isAvailable(),
    });
  }

  findPythonCandidate() {
    for (const command of ["python3.12", "python3.11", "python3.10", "python3"]) {
      const result = spawnSync(command, ["--version"], { encoding: "utf8", timeout: 5000 });
      if (result.error || result.status !== 0) continue;
      const version = parsePythonVersion(`${result.stdout}\n${result.stderr}`);
      if (isPythonVersionSupported(version)) {
        return { command, version };
      }
    }
    return null;
  }

  async checkInstallation() {
    const supported = isSupportedPlatform();
    const runtimeDir = this.getRuntimeDir();
    const executablePath = this.getExecutablePath();
    const pythonPath = fs.existsSync(this.getPythonPath()) ? this.getPythonPath() : null;

    if (!supported) {
      return {
        supported: false,
        installed: false,
        working: false,
        runtimeDir,
        executablePath,
        pythonPath,
        message: "Qwen ASR MLX is available only on Apple Silicon macOS.",
      };
    }

    return {
      supported: true,
      installed: Boolean(executablePath),
      working: Boolean(executablePath),
      runtimeDir,
      executablePath,
      pythonPath,
      message: executablePath
        ? "Qwen ASR MLX runtime is installed."
        : "MLX runtime is not installed.",
    };
  }

  runProcess(command, args, options = {}, progressCallback = null) {
    const timeoutMs = options.timeoutMs || 600000;
    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let completed = false;
      const proc = spawn(command, args, {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: options.env || process.env,
        cwd: options.cwd || getCacheDir(),
      });

      const timer = setTimeout(() => {
        if (completed) return;
        completed = true;
        killProcess(proc, "SIGTERM");
        reject(new Error(`Command timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);

      proc.stdout.on("data", (data) => {
        const text = data.toString();
        stdout += text;
        progressCallback?.(text, "stdout");
      });

      proc.stderr.on("data", (data) => {
        const text = data.toString();
        stderr += text;
        progressCallback?.(text, "stderr");
      });

      proc.on("error", (error) => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        reject(error);
      });

      proc.on("close", (code) => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          reject(new Error(stderr.trim() || stdout.trim() || `Command failed with code ${code}`));
        }
      });
    });
  }

  async installRuntime(progressCallback = null) {
    if (!isSupportedPlatform()) {
      return {
        success: false,
        ...(await this.checkInstallation()),
        error: "Qwen ASR MLX requires Apple Silicon macOS.",
      };
    }

    const python = this.findPythonCandidate();
    if (!python) {
      return {
        success: false,
        supported: true,
        installed: false,
        working: false,
        runtimeDir: this.getRuntimeDir(),
        executablePath: null,
        pythonPath: null,
        error: "Python 3.10 or newer is required to install Qwen ASR MLX.",
      };
    }

    await fsPromises.mkdir(path.dirname(this.getRuntimeDir()), { recursive: true });
    await fsPromises.mkdir(this.getModelsDir(), { recursive: true });

    if (!fs.existsSync(this.getPythonPath())) {
      progressCallback?.({ type: "installing", model: "runtime", percentage: 10 });
      await this.runProcess(python.command, ["-m", "venv", this.getRuntimeDir()], {
        timeoutMs: 120000,
      });
    }

    const runtimePython = this.getPythonPath();
    progressCallback?.({ type: "installing", model: "runtime", percentage: 35 });
    await this.runProcess(runtimePython, ["-m", "pip", "install", "--upgrade", "pip"], {
      timeoutMs: 120000,
    });

    progressCallback?.({ type: "installing", model: "runtime", percentage: 60 });
    await this.runProcess(runtimePython, ["-m", "pip", "install", RUNTIME_PACKAGE], {
      timeoutMs: 900000,
      env: this.serverManager.buildServerEnv(),
    });

    progressCallback?.({ type: "complete", model: "runtime", percentage: 100 });

    const status = await this.checkInstallation();
    return { success: status.working, ...status };
  }

  async startServer(modelName = DEFAULT_MODEL) {
    this.validateModelName(modelName);
    return this.serverManager.startServer(modelName);
  }

  async stopServer() {
    return this.serverManager.stopServer();
  }

  getServerStatus() {
    return this.serverManager.getServerStatus();
  }

  getModelCacheDir(modelName) {
    return this.serverManager.getModelCacheDir(modelName);
  }

  isModelDownloaded(modelName) {
    this.validateModelName(modelName);
    return this.serverManager.isModelDownloaded(modelName);
  }

  async writeModelMarker(modelName) {
    const config = getQwenModelConfig(modelName);
    await fsPromises.mkdir(this.getMarkerDir(), { recursive: true });
    await fsPromises.writeFile(
      this.getMarkerPath(modelName),
      JSON.stringify(
        {
          model: modelName,
          hfModelId: config.hfModelId,
          downloadedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );
  }

  async downloadQwenAsrModel(modelName, progressCallback = null) {
    this.validateModelName(modelName);
    const config = getQwenModelConfig(modelName);

    if (!isSupportedPlatform()) {
      return {
        success: false,
        model: modelName,
        downloaded: false,
        error: "Qwen ASR MLX requires Apple Silicon macOS.",
      };
    }

    const installStatus = await this.checkInstallation();
    if (!installStatus.working) {
      return {
        success: false,
        model: modelName,
        downloaded: false,
        error:
          installStatus.message || "Install the MLX runtime before downloading Qwen ASR models.",
        code: "RUNTIME_MISSING",
      };
    }

    if (this.isModelDownloaded(modelName)) {
      return {
        success: true,
        model: modelName,
        downloaded: true,
        path: this.getModelCacheDir(modelName),
        size_mb: config.sizeMb,
      };
    }

    await fsPromises.mkdir(this.getModelsDir(), { recursive: true });
    progressCallback?.({ type: "progress", model: modelName, percentage: 5 });

    const script = [
      "import os, sys",
      "from huggingface_hub import snapshot_download",
      "repo = sys.argv[1]",
      "cache_dir = os.path.join(sys.argv[2], 'hub')",
      "snapshot_download(repo_id=repo, cache_dir=cache_dir, local_files_only=False)",
    ].join("; ");

    const proc = spawn(
      this.getPythonPath(),
      ["-c", script, config.hfModelId, this.getModelsDir()],
      {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
        env: this.serverManager.buildServerEnv(),
        cwd: getCacheDir(),
      }
    );

    this.currentDownloadProcess = {
      abortRequested: false,
      abort: () => {
        this.currentDownloadProcess.abortRequested = true;
        killProcess(proc, "SIGTERM");
        setTimeout(() => killProcess(proc, "SIGKILL"), 5000);
      },
    };

    let stderr = "";
    let stdout = "";

    try {
      await new Promise((resolve, reject) => {
        proc.stdout.on("data", (data) => {
          stdout += data.toString();
          progressCallback?.({ type: "progress", model: modelName, percentage: 50 });
        });
        proc.stderr.on("data", (data) => {
          stderr += data.toString();
          progressCallback?.({ type: "progress", model: modelName, percentage: 50 });
        });
        proc.on("error", reject);
        proc.on("close", (code) => {
          if (this.currentDownloadProcess?.abortRequested) {
            reject(new Error("Download interrupted by user"));
            return;
          }
          if (code === 0) {
            resolve();
          } else {
            reject(
              new Error(stderr.trim() || stdout.trim() || `Download failed with code ${code}`)
            );
          }
        });
      });

      progressCallback?.({ type: "installing", model: modelName, percentage: 90 });
      await this.writeModelMarker(modelName);
      progressCallback?.({ type: "complete", model: modelName, percentage: 100 });

      return {
        success: true,
        model: modelName,
        downloaded: true,
        path: this.getModelCacheDir(modelName),
        size_mb: config.sizeMb,
      };
    } finally {
      this.currentDownloadProcess = null;
    }
  }

  async cancelDownload() {
    if (this.currentDownloadProcess) {
      this.currentDownloadProcess.abort();
      this.currentDownloadProcess = null;
      return { success: true, message: "Download cancelled" };
    }
    return { success: false, error: "No active download to cancel" };
  }

  async checkModelStatus(modelName) {
    this.validateModelName(modelName);
    const config = getQwenModelConfig(modelName);
    const cacheDir = this.getModelCacheDir(modelName);
    const downloaded = this.isModelDownloaded(modelName);
    const sizeBytes = downloaded ? await directorySizeBytes(cacheDir) : 0;

    return {
      success: true,
      model: modelName,
      downloaded,
      path: cacheDir,
      size_bytes: sizeBytes || config.expectedSizeBytes,
      size_mb: sizeBytes ? bytesToMb(sizeBytes) : config.sizeMb,
    };
  }

  async listQwenAsrModels() {
    const models = [];
    for (const modelName of getValidModelNames()) {
      models.push(await this.checkModelStatus(modelName));
    }
    return {
      success: true,
      models,
      cache_dir: this.getModelsDir(),
    };
  }

  async deleteQwenAsrModel(modelName) {
    this.validateModelName(modelName);
    const cacheDir = this.getModelCacheDir(modelName);
    const markerPath = this.getMarkerPath(modelName);
    const downloaded = this.isModelDownloaded(modelName);
    if (!downloaded) {
      return { success: false, model: modelName, deleted: false, error: "Model not found" };
    }

    const freedBytes = await directorySizeBytes(cacheDir);
    try {
      await fsPromises.rm(cacheDir, { recursive: true, force: true });
      await fsPromises.rm(markerPath, { force: true });
      return {
        success: true,
        model: modelName,
        deleted: true,
        freed_bytes: freedBytes,
        freed_mb: bytesToMb(freedBytes),
      };
    } catch (error) {
      return { success: false, model: modelName, deleted: false, error: error.message };
    }
  }

  async transcribeLocalQwenAsr(audioBlob, options = {}) {
    const model = options.model || DEFAULT_MODEL;
    this.validateModelName(model);

    if (!isSupportedPlatform()) {
      throw new Error("Qwen ASR MLX requires Apple Silicon macOS.");
    }

    if (!this.serverManager.isAvailable()) {
      throw new Error("mlx-qwen3-asr runtime not found. Install the MLX runtime in Settings.");
    }

    if (!this.isModelDownloaded(model)) {
      throw new Error(
        `Qwen ASR model "${model}" not downloaded. Please download it from Settings.`
      );
    }

    let audioBuffer;
    if (Buffer.isBuffer(audioBlob)) {
      audioBuffer = audioBlob;
    } else if (ArrayBuffer.isView(audioBlob)) {
      audioBuffer = Buffer.from(audioBlob.buffer, audioBlob.byteOffset, audioBlob.byteLength);
    } else if (audioBlob instanceof ArrayBuffer) {
      audioBuffer = Buffer.from(audioBlob);
    } else if (typeof audioBlob === "string") {
      audioBuffer = Buffer.from(audioBlob, "base64");
    } else if (audioBlob && audioBlob.buffer && typeof audioBlob.byteLength === "number") {
      audioBuffer = Buffer.from(audioBlob.buffer, audioBlob.byteOffset || 0, audioBlob.byteLength);
    } else {
      throw new Error(`Unsupported audio data type: ${typeof audioBlob}`);
    }

    if (!audioBuffer || audioBuffer.length === 0) {
      throw new Error("Audio buffer is empty - no audio data received");
    }

    const result = await this.serverManager.transcribe(audioBuffer, {
      modelName: model,
      language: options.language,
      prompt: options.prompt,
      context: options.context,
    });

    return this.parseQwenAsrResult(result);
  }

  parseQwenAsrResult(output) {
    if (!output || !output.text) {
      return { success: false, message: "No audio detected" };
    }

    const text = output.text.trim();
    if (!text) {
      return { success: false, message: "No audio detected" };
    }

    return { success: true, text };
  }

  async getDiagnostics() {
    const modelsDir = this.getModelsDir();
    let models = [];
    try {
      const list = await this.listQwenAsrModels();
      models = list.models.filter((model) => model.downloaded).map((model) => model.model);
    } catch {}

    return {
      platform: process.platform,
      arch: process.arch,
      supported: isSupportedPlatform(),
      runtimeDir: this.getRuntimeDir(),
      modelsDir,
      executablePath: this.getExecutablePath(),
      pythonPath: fs.existsSync(this.getPythonPath()) ? this.getPythonPath() : null,
      server: this.getServerStatus(),
      models,
    };
  }
}

module.exports = QwenAsrManager;
