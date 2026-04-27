import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type {
  LlamaServerStatus,
  LlamaVulkanStatus,
  VulkanGpuResult,
  LlamaVulkanDownloadProgress,
} from "../types/electron";
import { Button } from "./ui/button";
import { ErrorNotice } from "./ui/ErrorNotice";
import { Input } from "./ui/input";
import { Cloud, Lock, Zap } from "lucide-react";
import ApiKeyInput from "./ui/ApiKeyInput";
import { Toggle } from "./ui/toggle";
import SearchableModelSelect from "./ui/SearchableModelSelect";
import LocalModelPicker, { type LocalProvider } from "./LocalModelPicker";
import { ProviderTabs } from "./ui/ProviderTabs";
import { API_ENDPOINTS, normalizeBaseUrl } from "../config/constants";
import logger from "../utils/logger";
import { REASONING_PROVIDERS } from "../models/ModelRegistry";
import { modelRegistry } from "../models/ModelRegistry";
import { getProviderIcon, isMonochromeProvider } from "../utils/providerIcons";
import { isSecureEndpoint } from "../utils/urlUtils";
import { createExternalLinkHandler } from "../utils/externalLinks";
import { getCachedPlatform } from "../utils/platform";
import {
  createModelDiscoveryErrorMessage,
  createProviderModelDiscoveryCacheKey,
  createProviderModelDiscoveryRequest,
  getProviderModelDiscoveryBaseUrl,
  normalizeProviderModelResponse,
} from "../utils/providerModelDiscovery.mjs";

type CloudModelOption = {
  value: string;
  label: string;
  description?: string;
  descriptionKey?: string;
  icon?: string;
  ownedBy?: string;
  invertInDark?: boolean;
};

const cloudProviderIds = ["openai", "anthropic", "gemini", "groq", "bailian", "custom"];

interface ReasoningModelSelectorProps {
  reasoningModel: string;
  setReasoningModel: (model: string) => void;
  localReasoningProvider: string;
  setLocalReasoningProvider: (provider: string) => void;
  cloudReasoningBaseUrl: string;
  setCloudReasoningBaseUrl: (value: string) => void;
  openaiApiKey: string;
  setOpenaiApiKey: (key: string) => void;
  anthropicApiKey: string;
  setAnthropicApiKey: (key: string) => void;
  geminiApiKey: string;
  setGeminiApiKey: (key: string) => void;
  groqApiKey: string;
  setGroqApiKey: (key: string) => void;
  bailianApiKey: string;
  setBailianApiKey: (key: string) => void;
  bailianReasoningEnableThinking: boolean;
  setBailianReasoningEnableThinking: (enabled: boolean) => void;
  customReasoningApiKey?: string;
  setCustomReasoningApiKey?: (key: string) => void;
  customReasoningEnableThinking: boolean;
  setCustomReasoningEnableThinking: (enabled: boolean) => void;
}

function GpuStatusBadge() {
  const { t } = useTranslation();
  const [serverStatus, setServerStatus] = useState<LlamaServerStatus | null>(null);
  const [vulkanStatus, setVulkanStatus] = useState<LlamaVulkanStatus | null>(null);
  const [gpuResult, setGpuResult] = useState<VulkanGpuResult | null>(null);
  const [progress, setProgress] = useState<LlamaVulkanDownloadProgress | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activating, setActivating] = useState(false);
  const [activationFailed, setActivationFailed] = useState(false);
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem("llamaVulkanBannerDismissed") === "true"
  );
  const platform = getCachedPlatform();

  useEffect(() => {
    const poll = () => {
      window.electronAPI
        ?.llamaServerStatus?.()
        .then(setServerStatus)
        .catch(() => {});
      if (platform !== "darwin") {
        window.electronAPI
          ?.getLlamaVulkanStatus?.()
          .then(setVulkanStatus)
          .catch(() => {});
      }
    };
    poll();
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [platform]);

  useEffect(() => {
    if (platform !== "darwin") {
      window.electronAPI
        ?.detectVulkanGpu?.()
        .then(setGpuResult)
        .catch(() => {});
    }
  }, [platform]);

  useEffect(() => {
    const cleanup = window.electronAPI?.onLlamaVulkanDownloadProgress?.((data) => {
      setProgress(data);
    });
    return () => cleanup?.();
  }, []);

  useEffect(() => {
    if (!activating) return;
    if (serverStatus?.gpuAccelerated || vulkanStatus?.downloaded) {
      setActivating(false);
      setActivationFailed(false);
      return;
    }
    const timeout = setTimeout(() => {
      setActivating(false);
      setActivationFailed(true);
    }, 10000);
    const fastPoll = setInterval(() => {
      window.electronAPI
        ?.llamaServerStatus?.()
        .then(setServerStatus)
        .catch(() => {});
      window.electronAPI
        ?.getLlamaVulkanStatus?.()
        .then(setVulkanStatus)
        .catch(() => {});
    }, 1000);
    return () => {
      clearTimeout(timeout);
      clearInterval(fastPoll);
    };
  }, [activating, serverStatus?.gpuAccelerated, vulkanStatus?.downloaded]);

  const handleDownload = async () => {
    setDownloading(true);
    setError(null);
    try {
      const result = await window.electronAPI?.downloadLlamaVulkanBinary?.();
      if (result?.success) {
        setVulkanStatus((prev) => (prev ? { ...prev, downloaded: true } : prev));
        await window.electronAPI?.llamaGpuReset?.();
        setActivating(true);
        setActivationFailed(false);
      } else if (result && !result.cancelled) {
        setError(result.error || t("gpu.activationFailed"));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("gpu.activationFailed"));
    } finally {
      setDownloading(false);
      setProgress(null);
    }
  };

  const handleDelete = async () => {
    await window.electronAPI?.deleteLlamaVulkanBinary?.();
    setVulkanStatus((prev) => (prev ? { ...prev, downloaded: false } : prev));
  };

  const handleRetry = async () => {
    setActivationFailed(false);
    setActivating(true);
    await window.electronAPI?.llamaGpuReset?.();
  };

  // State 1: macOS
  if (platform === "darwin") {
    if (!serverStatus?.running) return null;
    return (
      <div className="flex items-center gap-1.5 mt-2 px-1">
        <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0 bg-success" />
        <span className="text-xs text-muted-foreground">{t("gpu.active")}</span>
      </div>
    );
  }

  // State 3: Downloading
  if (downloading && progress) {
    return (
      <div className="flex items-center gap-2 mt-2 px-1">
        <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${progress.percentage}%` }}
          />
        </div>
        <span className="text-xs text-muted-foreground tabular-nums">{progress.percentage}%</span>
        <button
          type="button"
          onClick={() => window.electronAPI?.cancelLlamaVulkanDownload?.()}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {t("gpu.cancel")}
        </button>
      </div>
    );
  }

  // State 3b: Error
  if (error) {
    return (
      <ErrorNotice
        message={error}
        compact
        className="mt-2"
        action={
          <button
            type="button"
            onClick={() => setError(null)}
            className="rounded-full px-2 py-0.5 text-[11px] font-medium text-[rgba(116,54,41,0.72)] transition-colors hover:text-[rgba(77,34,25,0.92)] dark:text-[rgba(255,214,198,0.74)] dark:hover:text-[rgba(255,239,232,0.94)]"
          >
            {t("gpu.dismiss")}
          </button>
        }
      />
    );
  }

  // State 5: Activating
  if (activating) {
    return (
      <div className="flex items-center gap-1.5 mt-2 px-1">
        <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0 bg-primary animate-pulse" />
        <span className="text-xs text-muted-foreground">{t("gpu.activating")}</span>
      </div>
    );
  }

  // State 4: Downloaded + GPU active
  if (vulkanStatus?.downloaded) {
    const isGpu = serverStatus?.gpuAccelerated && serverStatus?.backend === "vulkan";

    // State 6: Activation failed
    if (!isGpu && activationFailed) {
      return (
        <div className="flex items-center gap-1.5 mt-2 px-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0 bg-warning" />
          <span className="text-xs text-muted-foreground">{t("gpu.activationFailed")}</span>
          <button
            type="button"
            onClick={handleRetry}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-1"
          >
            {t("gpu.retry")}
          </button>
          <button
            type="button"
            onClick={handleDelete}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-auto"
          >
            {t("gpu.remove")}
          </button>
        </div>
      );
    }

    // State 4: GPU active or just downloaded
    return (
      <div className="flex items-center gap-1.5 mt-2 px-1">
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${isGpu ? "bg-success" : "bg-primary"}`}
        />
        <span className="text-xs text-muted-foreground">
          {isGpu ? t("gpu.active") : t("gpu.ready")}
        </span>
        <button
          type="button"
          onClick={handleDelete}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors ml-auto"
        >
          {t("gpu.remove")}
        </button>
      </div>
    );
  }

  // State 7: GPU available, not downloaded — show banner
  if (gpuResult?.available && !dismissed) {
    return (
      <div className="mt-2 rounded-md border border-primary/20 bg-primary/5 p-2.5">
        <div className="flex items-start gap-2.5">
          <Zap size={13} className="text-primary shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-foreground">{t("gpu.reasoningBanner")}</p>
            <div className="flex items-center gap-2 mt-1.5">
              <Button
                onClick={handleDownload}
                size="sm"
                variant="default"
                className="h-6 px-2.5 text-xs"
              >
                {t("gpu.enableButton")}
              </Button>
              <button
                onClick={() => {
                  localStorage.setItem("llamaVulkanBannerDismissed", "true");
                  setDismissed(true);
                }}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                {t("gpu.dismiss")}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export default function ReasoningModelSelector({
  reasoningModel,
  setReasoningModel,
  localReasoningProvider,
  setLocalReasoningProvider,
  cloudReasoningBaseUrl,
  setCloudReasoningBaseUrl,
  openaiApiKey,
  setOpenaiApiKey,
  anthropicApiKey,
  setAnthropicApiKey,
  geminiApiKey,
  setGeminiApiKey,
  groqApiKey,
  setGroqApiKey,
  bailianApiKey,
  setBailianApiKey,
  bailianReasoningEnableThinking,
  setBailianReasoningEnableThinking,
  customReasoningApiKey = "",
  setCustomReasoningApiKey,
  customReasoningEnableThinking,
  setCustomReasoningEnableThinking,
}: ReasoningModelSelectorProps) {
  const { t } = useTranslation();
  const [selectedMode, setSelectedMode] = useState<"cloud" | "local">("cloud");
  const [selectedCloudProvider, setSelectedCloudProvider] = useState("openai");
  const [selectedLocalProvider, setSelectedLocalProvider] = useState("qwen");
  const [discoveredCloudModelOptions, setDiscoveredCloudModelOptions] = useState<
    CloudModelOption[]
  >([]);
  const [modelDiscoveryLoading, setModelDiscoveryLoading] = useState(false);
  const [modelDiscoveryError, setModelDiscoveryError] = useState<string | null>(null);
  const [manualReasoningModelInput, setManualReasoningModelInput] = useState(reasoningModel);
  const [customBaseInput, setCustomBaseInput] = useState(cloudReasoningBaseUrl);
  const lastLoadedDiscoveryRef = useRef<string | null>(null);
  const pendingDiscoveryRef = useRef<string | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setCustomBaseInput(cloudReasoningBaseUrl);
  }, [cloudReasoningBaseUrl]);

  useEffect(() => {
    setManualReasoningModelInput(reasoningModel);
  }, [reasoningModel]);

  const defaultOpenAIBase = useMemo(() => normalizeBaseUrl(API_ENDPOINTS.OPENAI_BASE), []);
  const normalizedCustomReasoningBase = useMemo(
    () => normalizeBaseUrl(cloudReasoningBaseUrl),
    [cloudReasoningBaseUrl]
  );
  const hasCustomBase = normalizedCustomReasoningBase !== "";
  const effectiveReasoningBase = hasCustomBase ? normalizedCustomReasoningBase : defaultOpenAIBase;

  const getReasoningProviderApiKey = useCallback(
    (providerId: string) => {
      switch (providerId) {
        case "openai":
          return openaiApiKey;
        case "anthropic":
          return anthropicApiKey;
        case "gemini":
          return geminiApiKey;
        case "groq":
          return groqApiKey;
        case "bailian":
          return bailianApiKey;
        case "custom":
          return customReasoningApiKey;
        default:
          return "";
      }
    },
    [anthropicApiKey, bailianApiKey, customReasoningApiKey, geminiApiKey, groqApiKey, openaiApiKey]
  );

  const getReasoningProviderBaseUrl = useCallback(
    (providerId: string, baseOverride?: string) => {
      if (providerId === "custom") {
        return normalizeBaseUrl(baseOverride ?? cloudReasoningBaseUrl);
      }
      return getProviderModelDiscoveryBaseUrl(providerId);
    },
    [cloudReasoningBaseUrl]
  );

  const loadDiscoveredCloudModels = useCallback(
    async (providerOverride?: string, force = false, baseOverride?: string) => {
      const providerId = providerOverride || selectedCloudProvider;
      const base = getReasoningProviderBaseUrl(providerId, baseOverride);
      const apiKey = (getReasoningProviderApiKey(providerId) || "").trim();
      const discoveryKey = createProviderModelDiscoveryCacheKey({
        providerId,
        baseUrl: base,
        apiKey,
      });

      if (!base) {
        setDiscoveredCloudModelOptions([]);
        setModelDiscoveryError(null);
        setModelDiscoveryLoading(false);
        lastLoadedDiscoveryRef.current = null;
        pendingDiscoveryRef.current = null;
        return;
      }

      if (providerId !== "custom" && !apiKey) {
        setDiscoveredCloudModelOptions([]);
        setModelDiscoveryError(null);
        setModelDiscoveryLoading(false);
        lastLoadedDiscoveryRef.current = null;
        pendingDiscoveryRef.current = null;
        return;
      }

      if (!base.includes("://")) {
        setDiscoveredCloudModelOptions([]);
        setModelDiscoveryError(t("reasoning.custom.endpointWithProtocol"));
        setModelDiscoveryLoading(false);
        lastLoadedDiscoveryRef.current = null;
        pendingDiscoveryRef.current = null;
        return;
      }

      if (!isSecureEndpoint(base)) {
        setDiscoveredCloudModelOptions([]);
        setModelDiscoveryError(t("reasoning.custom.httpsRequired"));
        setModelDiscoveryLoading(false);
        lastLoadedDiscoveryRef.current = null;
        pendingDiscoveryRef.current = null;
        return;
      }

      if (!force && lastLoadedDiscoveryRef.current === discoveryKey) return;
      if (!force && pendingDiscoveryRef.current === discoveryKey) return;

      pendingDiscoveryRef.current = discoveryKey;
      setModelDiscoveryLoading(true);
      setModelDiscoveryError(null);
      setDiscoveredCloudModelOptions([]);

      try {
        if (!window.electronAPI?.processCloudReasoningRequest) {
          throw new Error(t("modelDiscovery.unableToLoad"));
        }

        const request = createProviderModelDiscoveryRequest({
          providerId,
          purpose: "reasoning",
          baseUrl: base,
          apiKey,
        });
        const response = await window.electronAPI.processCloudReasoningRequest({
          endpoint: request.endpoint,
          method: request.method,
          headers: request.headers as unknown as Record<string, string>,
          timeoutMs: request.timeoutMs,
        });

        if (!response.ok) {
          throw new Error(createModelDiscoveryErrorMessage(response));
        }

        const icon = getProviderIcon(providerId);
        const invertInDark = isMonochromeProvider(providerId);
        const mappedModels = normalizeProviderModelResponse({
          providerId,
          purpose: "reasoning",
          payload: response.json || {},
        }).map((model: CloudModelOption) => ({
          ...model,
          icon,
          invertInDark,
          description:
            model.description ||
            (model.ownedBy
              ? t("reasoning.custom.ownerLabel", { owner: model.ownedBy })
              : undefined),
        }));

        if (!isMountedRef.current || pendingDiscoveryRef.current !== discoveryKey) return;

        setDiscoveredCloudModelOptions(mappedModels);
        if (
          reasoningModel &&
          mappedModels.length > 0 &&
          !mappedModels.some((model: CloudModelOption) => model.value === reasoningModel)
        ) {
          setReasoningModel("");
        }
        setModelDiscoveryError(null);
        lastLoadedDiscoveryRef.current = discoveryKey;
      } catch (error) {
        if (isMountedRef.current && pendingDiscoveryRef.current === discoveryKey) {
          setModelDiscoveryError(createModelDiscoveryErrorMessage(error));
          setDiscoveredCloudModelOptions([]);
        }
      } finally {
        if (pendingDiscoveryRef.current === discoveryKey) {
          pendingDiscoveryRef.current = null;
        }
        if (isMountedRef.current) {
          setModelDiscoveryLoading(false);
        }
      }
    },
    [
      getReasoningProviderApiKey,
      getReasoningProviderBaseUrl,
      reasoningModel,
      selectedCloudProvider,
      setReasoningModel,
      t,
    ]
  );

  const trimmedCustomBase = customBaseInput.trim();
  const isCustomBaseDirty = trimmedCustomBase !== (cloudReasoningBaseUrl || "").trim();

  const displayedDiscoveredModels = useMemo<CloudModelOption[]>(() => {
    if (selectedCloudProvider === "custom" && isCustomBaseDirty) return [];
    return discoveredCloudModelOptions;
  }, [discoveredCloudModelOptions, isCustomBaseDirty, selectedCloudProvider]);

  const cloudProviders = cloudProviderIds.map((id) => ({
    id,
    name:
      id === "custom"
        ? t("reasoning.custom.providerName")
        : REASONING_PROVIDERS[id as keyof typeof REASONING_PROVIDERS]?.name || id,
  }));

  const localProviders = useMemo<LocalProvider[]>(() => {
    return modelRegistry.getAllProviders().map((provider) => ({
      id: provider.id,
      name: provider.name,
      models: provider.models.map((model) => ({
        id: model.id,
        name: model.name,
        size: model.size,
        sizeBytes: model.sizeBytes,
        description: model.description,
        recommended: model.recommended,
      })),
    }));
  }, []);

  const selectedCloudModels = useMemo<CloudModelOption[]>(() => {
    return displayedDiscoveredModels;
  }, [displayedDiscoveredModels]);

  const handleApplyCustomBase = useCallback(() => {
    const trimmedBase = customBaseInput.trim();
    const normalized = trimmedBase ? normalizeBaseUrl(trimmedBase) : trimmedBase;
    setCustomBaseInput(normalized);
    setCloudReasoningBaseUrl(normalized);
    lastLoadedDiscoveryRef.current = null;
    loadDiscoveredCloudModels("custom", true, normalized);
  }, [customBaseInput, setCloudReasoningBaseUrl, loadDiscoveredCloudModels]);

  const handleBaseUrlBlur = useCallback(() => {
    const trimmedBase = customBaseInput.trim();
    if (!trimmedBase) return;

    // Auto-apply on blur if changed
    if (trimmedBase !== (cloudReasoningBaseUrl || "").trim()) {
      handleApplyCustomBase();
    }
  }, [customBaseInput, cloudReasoningBaseUrl, handleApplyCustomBase]);

  const handleResetCustomBase = useCallback(() => {
    const defaultBase = API_ENDPOINTS.OPENAI_BASE;
    setCustomBaseInput(defaultBase);
    setCloudReasoningBaseUrl(defaultBase);
    lastLoadedDiscoveryRef.current = null;
    loadDiscoveredCloudModels("custom", true, defaultBase);
  }, [setCloudReasoningBaseUrl, loadDiscoveredCloudModels]);

  useEffect(() => {
    const localProviderIds = localProviders.map((p) => p.id);
    if (localProviderIds.includes(localReasoningProvider)) {
      setSelectedMode("local");
      setSelectedLocalProvider(localReasoningProvider);
    } else if (cloudProviderIds.includes(localReasoningProvider)) {
      setSelectedMode("cloud");
      setSelectedCloudProvider(localReasoningProvider);
    }
  }, [localProviders, localReasoningProvider]);

  useEffect(() => {
    if (selectedMode !== "cloud") return;
    if (selectedCloudProvider === "custom" && !hasCustomBase) {
      setModelDiscoveryError(null);
      setDiscoveredCloudModelOptions([]);
      setModelDiscoveryLoading(false);
      lastLoadedDiscoveryRef.current = null;
      return;
    }

    loadDiscoveredCloudModels();
  }, [
    selectedMode,
    selectedCloudProvider,
    hasCustomBase,
    normalizedCustomReasoningBase,
    openaiApiKey,
    anthropicApiKey,
    geminiApiKey,
    groqApiKey,
    bailianApiKey,
    customReasoningApiKey,
    loadDiscoveredCloudModels,
    t,
  ]);

  const [downloadedModels, setDownloadedModels] = useState<Set<string>>(new Set());

  const loadDownloadedModels = useCallback(async () => {
    try {
      const result = await window.electronAPI?.modelGetAll?.();
      if (result && Array.isArray(result)) {
        const downloaded = new Set(
          result
            .filter((m: { isDownloaded?: boolean }) => m.isDownloaded)
            .map((m: { id: string }) => m.id)
        );
        setDownloadedModels(downloaded);
        return downloaded;
      }
    } catch (error) {
      logger.error("Failed to load downloaded models", { error }, "models");
    }
    return new Set<string>();
  }, []);

  useEffect(() => {
    loadDownloadedModels();
  }, [loadDownloadedModels]);

  const handleModeChange = async (newMode: "cloud" | "local") => {
    setSelectedMode(newMode);

    if (newMode === "cloud") {
      window.electronAPI?.llamaServerStop?.();
      setLocalReasoningProvider(selectedCloudProvider);
      setReasoningModel("");
      if (selectedCloudProvider === "custom") setCustomBaseInput(cloudReasoningBaseUrl);
      lastLoadedDiscoveryRef.current = null;
      pendingDiscoveryRef.current = null;
      loadDiscoveredCloudModels(selectedCloudProvider, true);
    } else {
      setLocalReasoningProvider(selectedLocalProvider);
      const downloaded = await loadDownloadedModels();
      const provider = localProviders.find((p) => p.id === selectedLocalProvider);
      const models = provider?.models ?? [];
      if (models.length > 0) {
        const firstDownloaded = models.find((m) => downloaded.has(m.id));
        if (firstDownloaded) {
          setReasoningModel(firstDownloaded.id);
        } else {
          setReasoningModel("");
        }
      }
    }
  };

  const handleCloudProviderChange = (provider: string) => {
    setSelectedCloudProvider(provider);
    setLocalReasoningProvider(provider);
    setReasoningModel("");
    setDiscoveredCloudModelOptions([]);
    setModelDiscoveryError(null);
    lastLoadedDiscoveryRef.current = null;
    pendingDiscoveryRef.current = null;
    if (provider === "custom") setCustomBaseInput(cloudReasoningBaseUrl);
    loadDiscoveredCloudModels(provider, true);
  };

  const handleLocalProviderChange = async (providerId: string) => {
    setSelectedLocalProvider(providerId);
    setLocalReasoningProvider(providerId);
    const downloaded = await loadDownloadedModels();
    const provider = localProviders.find((p) => p.id === providerId);
    const models = provider?.models ?? [];
    if (models.length > 0) {
      const firstDownloaded = models.find((m) => downloaded.has(m.id));
      if (firstDownloaded) {
        setReasoningModel(firstDownloaded.id);
      } else {
        setReasoningModel("");
      }
    }
  };

  const handleRefreshDiscoveredModels = () => {
    if (selectedCloudProvider === "custom" && isCustomBaseDirty) {
      handleApplyCustomBase();
      return;
    }
    loadDiscoveredCloudModels(selectedCloudProvider, true);
  };

  const handleManualReasoningModelChange = (value: string) => {
    setManualReasoningModelInput(value);
    setReasoningModel(value.trim());
  };

  const renderReasoningModelDiscoveryPanel = () => {
    const providerBase =
      selectedCloudProvider === "custom"
        ? effectiveReasoningBase
        : getReasoningProviderBaseUrl(selectedCloudProvider);
    const hasProviderApiKey =
      selectedCloudProvider === "custom" ||
      Boolean((getReasoningProviderApiKey(selectedCloudProvider) || "").trim());

    return (
      <div className="space-y-2 pt-3">
        <div className="flex items-center justify-between gap-3">
          <h4 className="text-sm font-medium text-foreground">{t("reasoning.availableModels")}</h4>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={handleRefreshDiscoveredModels}
            disabled={
              modelDiscoveryLoading || (selectedCloudProvider === "custom" && !providerBase)
            }
            className="h-7 px-2 text-xs"
          >
            {modelDiscoveryLoading ? t("common.loading") : t("common.refresh")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{t("modelDiscovery.providerModelHint")}</p>
        {selectedCloudProvider === "custom" && isCustomBaseDirty && (
          <p className="text-xs text-primary">{t("reasoning.custom.modelsReloadHint")}</p>
        )}
        {!hasProviderApiKey && (
          <p className="text-xs text-warning">{t("modelDiscovery.enterApiKey")}</p>
        )}
        {modelDiscoveryLoading && (
          <p className="text-xs text-primary">{t("modelDiscovery.fetching")}</p>
        )}
        {modelDiscoveryError && (
          <ErrorNotice message={modelDiscoveryError} compact className="mt-2" />
        )}
        {!modelDiscoveryLoading &&
          !modelDiscoveryError &&
          hasProviderApiKey &&
          selectedCloudModels.length === 0 && (
            <p className="text-xs text-warning">{t("modelDiscovery.noModels")}</p>
          )}
        <SearchableModelSelect
          models={selectedCloudModels}
          selectedModel={reasoningModel}
          onModelSelect={setReasoningModel}
          placeholder={t("modelDiscovery.selectPlaceholder")}
          searchPlaceholder={t("modelDiscovery.searchPlaceholder")}
          emptyMessage={t("modelDiscovery.noModelsAvailable")}
        />
        <div className="space-y-1">
          <label className="text-xs font-medium text-foreground">
            {t("modelDiscovery.manualEntryLabel")}
          </label>
          <Input
            value={manualReasoningModelInput}
            onChange={(event) => handleManualReasoningModelChange(event.target.value)}
            placeholder={t("modelDiscovery.manualEntryPlaceholder")}
            className="h-8 text-sm"
          />
          <p className="text-xs text-muted-foreground/75">{t("modelDiscovery.manualEntryHelp")}</p>
        </div>
      </div>
    );
  };

  const MODE_TABS = [
    { id: "cloud", name: t("reasoning.mode.cloud") },
    { id: "local", name: t("reasoning.mode.local") },
  ];

  const renderModeIcon = (id: string) => {
    if (id === "cloud") return <Cloud className="w-4 h-4" />;
    return <Lock className="w-4 h-4" />;
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <ProviderTabs
          providers={MODE_TABS}
          selectedId={selectedMode}
          onSelect={(id) => handleModeChange(id as "cloud" | "local")}
          renderIcon={renderModeIcon}
          colorScheme="purple"
        />
        <p className="text-xs text-muted-foreground text-center">
          {selectedMode === "local"
            ? t("reasoning.mode.localDescription")
            : t("reasoning.mode.cloudDescription")}
        </p>
      </div>

      {selectedMode === "cloud" ? (
        <div className="space-y-2">
          <div className="border border-border rounded-lg overflow-hidden">
            <ProviderTabs
              providers={cloudProviders}
              selectedId={selectedCloudProvider}
              onSelect={handleCloudProviderChange}
              colorScheme="purple"
            />

            <div className="p-3">
              {selectedCloudProvider === "custom" ? (
                <>
                  <div className="space-y-2">
                    <h4 className="font-medium text-foreground">
                      {t("reasoning.custom.endpointTitle")}
                    </h4>
                    <Input
                      value={customBaseInput}
                      onChange={(event) => setCustomBaseInput(event.target.value)}
                      onBlur={handleBaseUrlBlur}
                      placeholder="https://api.openai.com/v1"
                      className="text-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("reasoning.custom.endpointExamples")}{" "}
                      <code className="text-primary">http://localhost:11434/v1</code>{" "}
                      {t("reasoning.custom.ollama")},{" "}
                      <code className="text-primary">http://localhost:8080/v1</code>{" "}
                      {t("reasoning.custom.localAi")}.
                    </p>
                  </div>

                  <div className="space-y-2 pt-3">
                    <h4 className="font-medium text-foreground">
                      {t("reasoning.custom.apiKeyOptional")}
                    </h4>
                    <ApiKeyInput
                      apiKey={customReasoningApiKey}
                      setApiKey={setCustomReasoningApiKey || (() => {})}
                      label=""
                      helpText={t("reasoning.custom.apiKeyHelp")}
                      saveMode="immediate"
                    />
                  </div>

                  <div className="pt-3">
                    <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="text-sm font-medium text-foreground">
                            {t("reasoning.custom.enableThinkingLabel")}
                          </h4>
                          <p className="text-xs text-muted-foreground mt-1">
                            {t("reasoning.custom.enableThinkingHelp")}
                          </p>
                        </div>
                        <div className="shrink-0 pt-0.5">
                          <Toggle
                            checked={customReasoningEnableThinking}
                            onChange={setCustomReasoningEnableThinking}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="pt-3">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleResetCustomBase}
                      className="h-7 px-2 text-xs"
                    >
                      {t("common.reset")}
                    </Button>
                  </div>

                  {renderReasoningModelDiscoveryPanel()}
                </>
              ) : selectedCloudProvider === "bailian" ? (
                <>
                  <div className="space-y-2">
                    <div className="flex items-baseline justify-between">
                      <h4 className="font-medium text-foreground">{t("common.apiKey")}</h4>
                    </div>
                    <ApiKeyInput
                      apiKey={bailianApiKey}
                      setApiKey={setBailianApiKey}
                      label=""
                      helpText={t("reasoning.bailian.apiKeyHelp")}
                      saveMode="immediate"
                    />
                  </div>

                  <div className="pt-3">
                    <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h4 className="text-sm font-medium text-foreground">
                            {t("reasoning.custom.enableThinkingLabel")}
                          </h4>
                          <p className="text-xs text-muted-foreground mt-1">
                            {t("reasoning.bailian.enableThinkingHelp")}
                          </p>
                        </div>
                        <div className="shrink-0 pt-0.5">
                          <Toggle
                            checked={bailianReasoningEnableThinking}
                            onChange={setBailianReasoningEnableThinking}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {renderReasoningModelDiscoveryPanel()}
                </>
              ) : (
                <>
                  {selectedCloudProvider === "openai" && (
                    <div className="space-y-2">
                      <div className="flex items-baseline justify-between">
                        <h4 className="font-medium text-foreground">{t("common.apiKey")}</h4>
                        <a
                          href="https://platform.openai.com/api-keys"
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={createExternalLinkHandler(
                            "https://platform.openai.com/api-keys"
                          )}
                          className="text-xs text-link underline decoration-link/30 hover:decoration-link/60 cursor-pointer transition-colors"
                        >
                          {t("reasoning.getApiKey")}
                        </a>
                      </div>
                      <ApiKeyInput
                        apiKey={openaiApiKey}
                        setApiKey={setOpenaiApiKey}
                        label=""
                        helpText=""
                      />
                    </div>
                  )}

                  {selectedCloudProvider === "anthropic" && (
                    <div className="space-y-2">
                      <div className="flex items-baseline justify-between">
                        <h4 className="font-medium text-foreground">{t("common.apiKey")}</h4>
                        <a
                          href="https://console.anthropic.com/settings/keys"
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={createExternalLinkHandler(
                            "https://console.anthropic.com/settings/keys"
                          )}
                          className="text-xs text-link underline decoration-link/30 hover:decoration-link/60 cursor-pointer transition-colors"
                        >
                          {t("reasoning.getApiKey")}
                        </a>
                      </div>
                      <ApiKeyInput
                        apiKey={anthropicApiKey}
                        setApiKey={setAnthropicApiKey}
                        label=""
                        helpText=""
                      />
                    </div>
                  )}

                  {selectedCloudProvider === "gemini" && (
                    <div className="space-y-2">
                      <div className="flex items-baseline justify-between">
                        <h4 className="font-medium text-foreground">{t("common.apiKey")}</h4>
                        <a
                          href="https://aistudio.google.com/app/api-keys"
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={createExternalLinkHandler(
                            "https://aistudio.google.com/app/api-keys"
                          )}
                          className="text-xs text-link underline decoration-link/30 hover:decoration-link/60 cursor-pointer transition-colors"
                        >
                          {t("reasoning.getApiKey")}
                        </a>
                      </div>
                      <ApiKeyInput
                        apiKey={geminiApiKey}
                        setApiKey={setGeminiApiKey}
                        label=""
                        helpText=""
                      />
                    </div>
                  )}

                  {selectedCloudProvider === "groq" && (
                    <div className="space-y-2">
                      <div className="flex items-baseline justify-between">
                        <h4 className="font-medium text-foreground">{t("common.apiKey")}</h4>
                        <a
                          href="https://console.groq.com/keys"
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={createExternalLinkHandler("https://console.groq.com/keys")}
                          className="text-xs text-link underline decoration-link/30 hover:decoration-link/60 cursor-pointer transition-colors"
                        >
                          {t("reasoning.getApiKey")}
                        </a>
                      </div>
                      <ApiKeyInput
                        apiKey={groqApiKey}
                        setApiKey={setGroqApiKey}
                        label=""
                        helpText=""
                      />
                    </div>
                  )}

                  {renderReasoningModelDiscoveryPanel()}
                </>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          <LocalModelPicker
            providers={localProviders}
            selectedModel={reasoningModel}
            selectedProvider={selectedLocalProvider}
            onModelSelect={setReasoningModel}
            onProviderSelect={handleLocalProviderChange}
            modelType="llm"
            colorScheme="purple"
            onDownloadComplete={loadDownloadedModels}
          />
          <GpuStatusBadge />
        </>
      )}
    </div>
  );
}
