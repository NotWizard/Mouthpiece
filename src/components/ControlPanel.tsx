import React, { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { Zap } from "lucide-react";
import { ConfirmDialog, AlertDialog } from "./ui/dialog";
import { useDialogs } from "../hooks/useDialogs";
import { useHotkey } from "../hooks/useHotkey";
import { useToast } from "./ui/Toast";
import { useSettings } from "../hooks/useSettings";
import { useAuth } from "../hooks/useAuth";
import {
  useTranscriptions,
  initializeTranscriptions,
  removeTranscription as removeFromStore,
} from "../stores/transcriptionStore";
import ControlPanelSidebar, { type ControlPanelView } from "./ControlPanelSidebar";
import WindowControls from "./WindowControls";
import { getCachedPlatform } from "../utils/platform";
import HistoryView from "./HistoryView";
import type { AppUpdateStatus } from "../types/electron";

const platform = getCachedPlatform();

const ReferralModal = React.lazy(() => import("./ReferralModal"));
const DictionaryView = React.lazy(() => import("./DictionaryView"));
const SettingsPage = React.lazy(() => import("./SettingsPage"));
const SIDEBAR_VIEW_CONTENT_CLASS_NAME = "control-panel-view-content";

export default function ControlPanel() {
  const { t } = useTranslation();
  const history = useTranscriptions();
  const [isLoading, setIsLoading] = useState(true);
  const [aiCTADismissed, setAiCTADismissed] = useState(
    () => localStorage.getItem("aiCTADismissed") === "true"
  );
  const [showReferrals, setShowReferrals] = useState(false);
  const [showCloudMigrationBanner, setShowCloudMigrationBanner] = useState(false);
  const [activeView, setActiveView] = useState<ControlPanelView>("home");
  const [updateStatus, setUpdateStatus] = useState<AppUpdateStatus | null>(null);
  const [gpuAccelAvailable, setGpuAccelAvailable] = useState<{ cuda: boolean; vulkan: boolean }>({
    cuda: false,
    vulkan: false,
  });
  const [gpuBannerDismissed, setGpuBannerDismissed] = useState(
    () => localStorage.getItem("gpuBannerDismissedUnified") === "true"
  );
  const promptedDownloadedUpdateRef = useRef<string | null>(null);
  const { hotkey } = useHotkey();
  const { toast } = useToast();
  const { useLocalWhisper, localTranscriptionProvider, useReasoningModel } = useSettings();
  const { isSignedIn, isLoaded: authLoaded, user } = useAuth();

  const {
    confirmDialog,
    alertDialog,
    showConfirmDialog,
    showAlertDialog,
    hideConfirmDialog,
    hideAlertDialog,
  } = useDialogs();

  useEffect(() => {
    if (platform === "darwin" || gpuBannerDismissed) return;
    const detect = async () => {
      const results = { cuda: false, vulkan: false };
      if (useLocalWhisper && localTranscriptionProvider === "whisper") {
        try {
          const status = await window.electronAPI?.getCudaWhisperStatus?.();
          if (status?.gpuInfo.hasNvidiaGpu && !status.downloaded) results.cuda = true;
        } catch {}
      }
      if (useReasoningModel) {
        try {
          const [gpu, vulkan] = await Promise.all([
            window.electronAPI?.detectVulkanGpu?.(),
            window.electronAPI?.getLlamaVulkanStatus?.(),
          ]);
          if (gpu?.available && !vulkan?.downloaded) results.vulkan = true;
        } catch {}
      }
      setGpuAccelAvailable(results);
    };
    detect();
  }, [useLocalWhisper, localTranscriptionProvider, useReasoningModel, gpuBannerDismissed]);

  const loadTranscriptions = useCallback(async () => {
    try {
      setIsLoading(true);
      await initializeTranscriptions();
    } catch (error) {
      showAlertDialog({
        title: t("controlPanel.history.couldNotLoadTitle"),
        description: t("controlPanel.history.couldNotLoadDescription"),
      });
    } finally {
      setIsLoading(false);
    }
  }, [showAlertDialog, t]);

  useEffect(() => {
    void loadTranscriptions();
  }, [loadTranscriptions]);

  useEffect(() => {
    let mounted = true;

    const loadUpdateStatus = async () => {
      try {
        const status = await window.electronAPI?.getUpdateStatus?.();
        if (mounted && status) {
          setUpdateStatus(status);
        }
      } catch {}
    };

    void loadUpdateStatus();
    const unsubscribe = window.electronAPI?.onUpdateStatusChanged?.((status) => {
      if (mounted) {
        setUpdateStatus(status);
      }
    });

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  const copyToClipboard = useCallback(
    async (text: string) => {
      try {
        const electronCopyResult = await window.electronAPI?.writeClipboard?.(text);
        if (electronCopyResult?.success) {
          return true;
        }

        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
          return true;
        }

        throw new Error("Clipboard write failed");
      } catch (err) {
        toast({
          title: t("controlPanel.history.couldNotCopyTitle"),
          description: t("controlPanel.history.couldNotCopyDescription"),
          variant: "destructive",
        });
        return false;
      }
    },
    [toast, t]
  );

  const deleteTranscription = useCallback(
    async (id: number) => {
      showConfirmDialog({
        title: t("controlPanel.history.deleteTitle"),
        description: t("controlPanel.history.deleteDescription"),
        onConfirm: async () => {
          try {
            const result = await window.electronAPI.deleteTranscription(id);
            if (result.success) {
              removeFromStore(id);
            } else {
              showAlertDialog({
                title: t("controlPanel.history.couldNotDeleteTitle"),
                description: t("controlPanel.history.couldNotDeleteDescription"),
              });
            }
          } catch {
            showAlertDialog({
              title: t("controlPanel.history.couldNotDeleteTitle"),
              description: t("controlPanel.history.couldNotDeleteDescriptionGeneric"),
            });
          }
        },
        variant: "destructive",
      });
    },
    [showConfirmDialog, showAlertDialog, t]
  );

  const performInstallUpdate = useCallback(async () => {
    const result = await window.electronAPI?.installUpdate?.();
    if (!result?.success) {
      showAlertDialog({
        title: t("controlPanel.update.couldNotInstallTitle"),
        description: result?.error || t("controlPanel.update.couldNotInstallDescription"),
      });
    }
  }, [showAlertDialog, t]);

  const handleInstallUpdate = useCallback(() => {
    if (updateStatus?.status === "installing") {
      return;
    }

    showConfirmDialog({
      title: t("controlPanel.update.installTitle"),
      description: t("controlPanel.update.installDescription"),
      confirmText: t("controlPanel.update.installButton"),
      cancelText: t("common.cancel"),
      onConfirm: performInstallUpdate,
    });
  }, [performInstallUpdate, showConfirmDialog, t, updateStatus?.status]);

  const handleManualCheckForUpdates = useCallback(async () => {
    try {
      const status = await window.electronAPI?.checkForUpdates?.();

      if (status) {
        setUpdateStatus(status);
      }

      if (!status) {
        showAlertDialog({
          title: t("settingsModal.updates.dialogs.checkFailed.title"),
          description: t("settingsModal.updates.dialogs.checkFailed.description"),
        });
        return;
      }

      if (status.status === "unsupported") {
        showAlertDialog({
          title: t("settingsModal.updates.dialogs.checkFailed.title"),
          description: t("settingsModal.updates.devMode"),
        });
        return;
      }

      if (status.status === "error") {
        showAlertDialog({
          title: t("settingsModal.updates.dialogs.checkFailed.title"),
          description: status.error || t("settingsModal.updates.dialogs.checkFailed.description"),
        });
        return;
      }

      if (status.status === "downloading") {
        const version = status.updateInfo?.version || status.updateInfo?.releaseName;
        showAlertDialog({
          title: t("settingsModal.updates.dialogs.updateAvailable.title"),
          description: version
            ? t("settingsModal.updates.dialogs.updateAvailable.description", { version })
            : t("settingsModal.updates.newVersionAvailable"),
        });
        return;
      }

      if (status.status === "downloaded") {
        const updateKey =
          status.updateInfo?.version || status.updateInfo?.releaseName || "downloaded";

        if (
          promptedDownloadedUpdateRef.current === updateKey ||
          updateStatus?.status === "downloaded"
        ) {
          handleInstallUpdate();
        }
        return;
      }

      if (status.status === "installing" || status.status === "checking") {
        return;
      }

      showAlertDialog({
        title: t("settingsModal.updates.dialogs.noUpdates.title"),
        description: t("settingsModal.updates.dialogs.noUpdates.description"),
      });
    } catch (error) {
      showAlertDialog({
        title: t("settingsModal.updates.dialogs.checkFailed.title"),
        description:
          error instanceof Error && error.message
            ? error.message
            : t("settingsModal.updates.dialogs.checkFailed.description"),
      });
    }
  }, [handleInstallUpdate, showAlertDialog, t, updateStatus?.status]);

  useEffect(() => {
    if (updateStatus?.status !== "downloaded") {
      return;
    }

    const updateKey =
      updateStatus.updateInfo?.version || updateStatus.updateInfo?.releaseName || "downloaded";
    if (promptedDownloadedUpdateRef.current === updateKey) {
      return;
    }

    promptedDownloadedUpdateRef.current = updateKey;
    showConfirmDialog({
      title: t("controlPanel.update.readyTitle"),
      description: t("controlPanel.update.readyDescription"),
      confirmText: t("controlPanel.update.installButton"),
      cancelText: t("common.cancel"),
      onConfirm: performInstallUpdate,
    });
  }, [
    performInstallUpdate,
    showConfirmDialog,
    t,
    updateStatus?.status,
    updateStatus?.updateInfo?.releaseName,
    updateStatus?.updateInfo?.version,
  ]);

  const updateAction =
    updateStatus?.status === "downloaded" || updateStatus?.status === "installing"
      ? {
          label:
            updateStatus.status === "installing"
              ? t("controlPanel.update.installing")
              : t("controlPanel.update.availableButton"),
          disabled: updateStatus.status === "installing",
          onClick: handleInstallUpdate,
        }
      : undefined;

  return (
    <div className="control-panel-shell h-screen flex flex-col">
      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={hideConfirmDialog}
        title={confirmDialog.title}
        description={confirmDialog.description}
        onConfirm={confirmDialog.onConfirm}
        variant={confirmDialog.variant}
      />

      <AlertDialog
        open={alertDialog.open}
        onOpenChange={hideAlertDialog}
        title={alertDialog.title}
        description={alertDialog.description}
        onOk={() => {}}
      />

      {showReferrals && (
        <Suspense fallback={null}>
          <ReferralModal open={showReferrals} onOpenChange={setShowReferrals} />
        </Suspense>
      )}

      <div className="flex flex-1 overflow-hidden">
        <ControlPanelSidebar
          activeView={activeView}
          onViewChange={setActiveView}
          onOpenReferrals={() => setShowReferrals(true)}
          userName={user?.name}
          userEmail={user?.email}
          userImage={user?.image}
          isSignedIn={isSignedIn}
          authLoaded={authLoaded}
          updateAction={updateAction}
        />
        <main className="control-panel-main flex-1 flex flex-col overflow-hidden">
          <div
            className="control-panel-titlebar flex items-center justify-end w-full h-10 shrink-0"
            style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
          >
            {platform !== "darwin" && (
              <div className="pr-1" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
                <WindowControls />
              </div>
            )}
          </div>
          <div className="control-panel-content-scroll flex-1 overflow-y-auto">
            {(gpuAccelAvailable.cuda || gpuAccelAvailable.vulkan) &&
              activeView === "home" &&
              !gpuBannerDismissed && (
                <div className="history-view pb-0!">
                  <div className="control-panel-banner p-3">
                    <div className="flex items-start gap-3">
                      <div className="shrink-0 w-8 h-8 rounded-md bg-primary/10 dark:bg-primary/15 flex items-center justify-center">
                        <Zap size={16} className="text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground mb-0.5">
                          {t("controlPanel.gpu.bannerTitle")}
                        </p>
                        <p className="text-xs text-muted-foreground mb-2">
                          {t("controlPanel.gpu.bannerDescription")}
                        </p>
                        <div className="flex items-center gap-3">
                          <Button
                            variant="default"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => {
                              setActiveView(
                                gpuAccelAvailable.cuda ? "transcription" : "intelligence"
                              );
                            }}
                          >
                            {t("controlPanel.gpu.enableButton")}
                          </Button>
                          <button
                            onClick={() => {
                              setGpuBannerDismissed(true);
                              localStorage.setItem("gpuBannerDismissedUnified", "true");
                            }}
                            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                          >
                            {t("controlPanel.gpu.dismissButton")}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            {activeView === "home" && (
              <HistoryView
                history={history}
                isLoading={isLoading}
                hotkey={hotkey}
                showCloudMigrationBanner={showCloudMigrationBanner}
                setShowCloudMigrationBanner={setShowCloudMigrationBanner}
                aiCTADismissed={aiCTADismissed}
                setAiCTADismissed={setAiCTADismissed}
                useReasoningModel={useReasoningModel}
                copyToClipboard={copyToClipboard}
                deleteTranscription={deleteTranscription}
                onOpenSettings={(section) => {
                  setActiveView(section as ControlPanelView);
                }}
              />
            )}
            {activeView === "dictionary" && (
              <div className={SIDEBAR_VIEW_CONTENT_CLASS_NAME}>
                <Suspense fallback={null}>
                  <DictionaryView />
                </Suspense>
              </div>
            )}
            {(activeView === "general" ||
              activeView === "hotkeys" ||
              activeView === "transcription" ||
              activeView === "intelligence" ||
              activeView === "privacyData" ||
              activeView === "system") && (
              <div className={SIDEBAR_VIEW_CONTENT_CLASS_NAME}>
                <Suspense fallback={null}>
                  <SettingsPage
                    activeSection={activeView}
                    updateStatus={updateStatus}
                    onCheckForUpdates={handleManualCheckForUpdates}
                    onInstallUpdate={handleInstallUpdate}
                  />
                </Suspense>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
