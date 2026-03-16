import React, { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import { ChevronRight, ChevronLeft, Check, Mic, Shield, Command, UserCircle } from "lucide-react";
import TitleBar from "./TitleBar";
import WindowControls from "./WindowControls";
import PermissionCard from "./ui/PermissionCard";
import SupportDropdown from "./ui/SupportDropdown";
import MicPermissionWarning from "./ui/MicPermissionWarning";
import PasteToolsInfo from "./ui/PasteToolsInfo";
import StepProgress from "./ui/StepProgress";
import { AlertDialog, ConfirmDialog } from "./ui/dialog";
import { useLocalStorage } from "../hooks/useLocalStorage";
import { useDialogs } from "../hooks/useDialogs";
import { usePermissions } from "../hooks/usePermissions";
import { useClipboard } from "../hooks/useClipboard";
import { useSettings } from "../hooks/useSettings";
import AuthenticationStep from "./AuthenticationStep";
import EmailVerificationStep from "./EmailVerificationStep";
import { setAgentName as saveAgentName } from "../utils/agentName";
import { formatHotkeyLabel, getDefaultHotkey, isGlobeLikeHotkey } from "../utils/hotkeys";
import { useAuth } from "../hooks/useAuth";
import { NEON_AUTH_URL } from "../lib/neonAuth";
import { HotkeyInput } from "./ui/HotkeyInput";
import { useHotkeyRegistration } from "../hooks/useHotkeyRegistration";
import { getValidationMessage } from "../utils/hotkeyValidator";
import { getPlatform } from "../utils/platform";
import logger from "../utils/logger";
import {
  getActivationStepIndex,
  getOnboardingMaxStep,
  getOnboardingStepKeys,
} from "../utils/onboardingFlow.mjs";

interface OnboardingFlowProps {
  onComplete: () => void;
}

export default function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const { t } = useTranslation();
  const { isSignedIn } = useAuth();
  const cloudAuthAvailable = Boolean(NEON_AUTH_URL);
  const hasCloudSession = cloudAuthAvailable && isSignedIn;
  const maxOnboardingStep = getOnboardingMaxStep();
  const stepKeys = getOnboardingStepKeys();

  const [currentStep, setCurrentStep, removeCurrentStep] = useLocalStorage(
    "onboardingCurrentStep",
    0,
    {
      serialize: String,
      deserialize: (value) => {
        const parsed = parseInt(value, 10);
        if (isNaN(parsed) || parsed < 0) return 0;
        if (parsed > maxOnboardingStep) return maxOnboardingStep;
        return parsed;
      },
    }
  );

  const { dictationKey, setDictationKey } = useSettings();

  const [hotkey, setHotkey] = useState(dictationKey || getDefaultHotkey());
  const agentName = "Mouthpiece";
  const [skipAuth, setSkipAuth] = useState(false);
  const [pendingVerificationEmail, setPendingVerificationEmail] = useState<string | null>(null);
  const [isUsingGnomeHotkeys, setIsUsingGnomeHotkeys] = useState(false);
  const readableHotkey = formatHotkeyLabel(hotkey);
  const { alertDialog, confirmDialog, showAlertDialog, hideAlertDialog, hideConfirmDialog } =
    useDialogs();

  const autoRegisterInFlightRef = useRef(false);
  const hotkeyStepInitializedRef = useRef(false);

  const { registerHotkey, isRegistering: isHotkeyRegistering } = useHotkeyRegistration({
    onSuccess: (registeredHotkey) => {
      setHotkey(registeredHotkey);
      setDictationKey(registeredHotkey);
    },
    showSuccessToast: false,
    showErrorToast: false,
  });

  const validateHotkeyForInput = useCallback(
    (hotkey: string) => getValidationMessage(hotkey, getPlatform()),
    []
  );

  const permissionsHook = usePermissions(showAlertDialog);
  useClipboard(showAlertDialog); // Initialize clipboard hook for permission checks

  const steps = stepKeys.map((stepKey) => {
    switch (stepKey) {
      case "permissions":
        return { title: t("onboarding.steps.permissions"), icon: Shield };
      case "activation":
        return { title: t("onboarding.steps.activation"), icon: Command };
      case "welcome":
      default:
        return { title: t("onboarding.steps.welcome"), icon: UserCircle };
    }
  });

  const showProgress = currentStep > 0;

  useEffect(() => {
    const checkHotkeyMode = async () => {
      try {
        const info = await window.electronAPI?.getHotkeyModeInfo();
        if (info?.isUsingGnome) {
          setIsUsingGnomeHotkeys(true);
        }
      } catch (error) {
        logger.error("Failed to check hotkey mode", { error }, "onboarding");
      }
    };
    checkHotkeyMode();
  }, []);

  const activationStepIndex = getActivationStepIndex();

  useEffect(() => {
    if (currentStep !== activationStepIndex) {
      // Reset initialization flag when leaving activation step
      hotkeyStepInitializedRef.current = false;
      return;
    }

    // Prevent double-invocation from React.StrictMode
    if (autoRegisterInFlightRef.current || hotkeyStepInitializedRef.current) {
      return;
    }

    const autoRegisterDefaultHotkey = async () => {
      autoRegisterInFlightRef.current = true;
      hotkeyStepInitializedRef.current = true;

      try {
        // Get platform-appropriate default hotkey
        const defaultHotkey = getDefaultHotkey();
        const platform = window.electronAPI?.getPlatform?.() ?? "darwin";

        // Only auto-register if no hotkey is currently set
        const shouldAutoRegister =
          !hotkey || hotkey.trim() === "" || (platform !== "darwin" && isGlobeLikeHotkey(hotkey));

        if (shouldAutoRegister) {
          // Try to register the default hotkey silently
          const success = await registerHotkey(defaultHotkey);
          if (success) {
            setHotkey(defaultHotkey);
          }
        }
      } catch (error) {
        logger.error("Failed to auto-register default hotkey", { error }, "onboarding");
      } finally {
        autoRegisterInFlightRef.current = false;
      }
    };

    void autoRegisterDefaultHotkey();
  }, [currentStep, hotkey, registerHotkey, activationStepIndex]);

  const ensureHotkeyRegistered = useCallback(async () => {
    if (!window.electronAPI?.updateHotkey) {
      return true;
    }

    try {
      const result = await window.electronAPI.updateHotkey(hotkey);
      if (result && !result.success) {
        showAlertDialog({
          title: t("onboarding.hotkey.couldNotRegisterTitle"),
          description: result.message || t("onboarding.hotkey.couldNotRegisterDescription"),
        });
        return false;
      }
      return true;
    } catch (error) {
      logger.error("Failed to register onboarding hotkey", { error }, "onboarding");
      showAlertDialog({
        title: t("onboarding.hotkey.couldNotRegisterTitle"),
        description: t("onboarding.hotkey.couldNotRegisterDescription"),
      });
      return false;
    }
  }, [hotkey, showAlertDialog, t]);

  const saveSettings = useCallback(async () => {
    const hotkeyRegistered = await ensureHotkeyRegistered();
    if (!hotkeyRegistered) {
      return false;
    }
    setDictationKey(hotkey);
    saveAgentName(agentName);

    const skippedAuth = skipAuth;
    localStorage.setItem("authenticationSkipped", skippedAuth.toString());
    localStorage.setItem("onboardingCompleted", "true");
    localStorage.setItem("skipAuth", skippedAuth.toString());

    return true;
  }, [hotkey, agentName, setDictationKey, ensureHotkeyRegistered, skipAuth]);

  const nextStep = useCallback(async () => {
    if (currentStep >= steps.length - 1) {
      return;
    }

    const newStep = currentStep + 1;
    setCurrentStep(newStep);

    // Show dictation panel when entering activation step
    if (newStep === activationStepIndex) {
      if (window.electronAPI?.showDictationPanel) {
        window.electronAPI.showDictationPanel();
      }
    }
  }, [currentStep, setCurrentStep, steps.length, activationStepIndex]);

  const prevStep = useCallback(() => {
    if (currentStep > 0) {
      const newStep = currentStep - 1;
      setCurrentStep(newStep);
    }
  }, [currentStep, setCurrentStep]);

  const finishOnboarding = useCallback(async () => {
    const saved = await saveSettings();
    if (!saved) {
      return;
    }
    removeCurrentStep();
    onComplete();
  }, [saveSettings, removeCurrentStep, onComplete]);

  const renderStep = () => {
    switch (currentStep) {
      case 0: // Authentication (with Welcome)
        if (pendingVerificationEmail) {
          return (
            <EmailVerificationStep
              email={pendingVerificationEmail}
              onVerified={() => {
                setPendingVerificationEmail(null);
                nextStep();
              }}
            />
          );
        }
        return (
          <AuthenticationStep
            onContinueWithoutAccount={() => {
              setSkipAuth(true);
              nextStep();
            }}
            onAuthComplete={() => {
              nextStep();
            }}
            onNeedsVerification={(email) => {
              setPendingVerificationEmail(email);
            }}
          />
        );

      case 1: // Permissions
        const platform = permissionsHook.pasteToolsInfo?.platform;
        const isMacOS = platform === "darwin";

        return (
          <div className="space-y-4">
            {/* Header - compact */}
            <div className="text-center">
              <h2 className="text-lg font-semibold text-foreground tracking-tight">
                {t("onboarding.permissions.title")}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isMacOS
                  ? t("onboarding.permissions.requiredForApp")
                  : t("onboarding.permissions.microphoneRequired")}
              </p>
            </div>

            {/* Permission cards - tight stack */}
            <div className="space-y-1.5">
              <PermissionCard
                icon={Mic}
                title={t("onboarding.permissions.microphoneTitle")}
                description={t("onboarding.permissions.microphoneDescription")}
                granted={permissionsHook.micPermissionGranted}
                onRequest={permissionsHook.requestMicPermission}
                buttonText={t("onboarding.permissions.grant")}
              />

              {isMacOS && (
                <PermissionCard
                  icon={Shield}
                  title={t("onboarding.permissions.accessibilityTitle")}
                  description={t("onboarding.permissions.accessibilityDescription")}
                  granted={permissionsHook.accessibilityPermissionGranted}
                  onRequest={permissionsHook.testAccessibilityPermission}
                  buttonText={t("onboarding.permissions.testAndGrant")}
                  onOpenSettings={permissionsHook.openAccessibilitySettings}
                />
              )}
            </div>

            {/* Error state - only show when there's actually an issue */}
            {!permissionsHook.micPermissionGranted && permissionsHook.micPermissionError && (
              <MicPermissionWarning
                error={permissionsHook.micPermissionError}
                onOpenSoundSettings={permissionsHook.openSoundInputSettings}
                onOpenPrivacySettings={permissionsHook.openMicPrivacySettings}
              />
            )}

            {/* Linux paste tools - only when needed */}
            {platform === "linux" &&
              permissionsHook.pasteToolsInfo &&
              !permissionsHook.pasteToolsInfo.available && (
                <PasteToolsInfo
                  pasteToolsInfo={permissionsHook.pasteToolsInfo}
                  isChecking={permissionsHook.isCheckingPasteTools}
                  onCheck={permissionsHook.checkPasteToolsAvailability}
                />
              )}
          </div>
        );

      case 2: // Activation
        return renderActivationStep();

      default:
        return null;
    }
  };

  const renderActivationStep = () => (
    <div className="space-y-4">
      {/* Header */}
      <div className="text-center space-y-0.5">
        <h2 className="text-lg font-semibold text-foreground tracking-tight">
          {t("onboarding.activation.title")}
        </h2>
        <p className="text-xs text-muted-foreground">{t("onboarding.activation.description")}</p>
      </div>

      {/* Unified control surface */}
      <div className="rounded-lg border border-border-subtle bg-surface-1 overflow-hidden">
        {/* Hotkey section */}
        <div className="p-4 border-b border-border-subtle">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {t("onboarding.activation.hotkey")}
            </span>
          </div>
          <HotkeyInput
            value={hotkey}
            onChange={async (newHotkey) => {
              const success = await registerHotkey(newHotkey);
              if (success) {
                setHotkey(newHotkey);
              }
            }}
            disabled={isHotkeyRegistering}
            variant="hero"
            validate={validateHotkeyForInput}
          />
        </div>

        <div className="p-4 space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {t("onboarding.activation.mode")}
          </span>
          <p className="text-xs text-muted-foreground/70 mt-0.5">
            {t("onboarding.activation.modeDescription")}
          </p>
          {isUsingGnomeHotkeys && (
            <p className="text-xs text-muted-foreground/60">
              {t("onboarding.activation.modeFallbackDescription")}
            </p>
          )}
        </div>
      </div>

      {/* Test area - minimal chrome */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {t("onboarding.activation.test")}
          </span>
          <span className="text-xs text-muted-foreground/60">
            {t("onboarding.activation.testDescription", { hotkey: readableHotkey })}
          </span>
        </div>
        <Textarea
          rows={2}
          placeholder={t("onboarding.activation.textareaPlaceholder")}
          className="text-sm resize-none"
        />
      </div>
    </div>
  );

  const canProceed = () => {
    switch (currentStep) {
      case 0:
        return hasCloudSession || skipAuth; // Authentication step
      case 1:
        // Permissions step
        if (!permissionsHook.micPermissionGranted) {
          return false;
        }
        const currentPlatform = permissionsHook.pasteToolsInfo?.platform;
        if (currentPlatform === "darwin") {
          return permissionsHook.accessibilityPermissionGranted;
        }
        return true;
      case 2:
        return hotkey.trim() !== ""; // Activation step
      default:
        return false;
    }
  };

  // Load Google Font only in the browser
  React.useEffect(() => {
    const link = document.createElement("link");
    link.href =
      "https://fonts.googleapis.com/css2?family=Noto+Sans:wght@300;400;500;600;700&display=swap";
    link.rel = "stylesheet";
    document.head.appendChild(link);
    return () => {
      document.head.removeChild(link);
    };
  }, []);

  const onboardingPlatform =
    typeof window !== "undefined" && window.electronAPI?.getPlatform
      ? window.electronAPI.getPlatform()
      : "darwin";

  return (
    <div
      className="h-screen flex flex-col bg-background"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => !open && hideConfirmDialog()}
        title={confirmDialog.title}
        description={confirmDialog.description}
        confirmText={confirmDialog.confirmText}
        cancelText={confirmDialog.cancelText}
        onConfirm={confirmDialog.onConfirm}
      />

      <AlertDialog
        open={alertDialog.open}
        onOpenChange={(open) => !open && hideAlertDialog()}
        title={alertDialog.title}
        description={alertDialog.description}
        onOk={() => {}}
      />

      {/* Title Bar / drag region */}
      {currentStep === 0 ? (
        <div
          className="flex items-center justify-end w-full h-10 shrink-0"
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        >
          {onboardingPlatform !== "darwin" && (
            <div className="pr-1" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
              <WindowControls />
            </div>
          )}
        </div>
      ) : (
        <div className="shrink-0 z-10">
          <TitleBar
            showTitle={true}
            className="bg-background backdrop-blur-xl border-b border-border shadow-sm"
            actions={hasCloudSession ? <SupportDropdown /> : undefined}
          ></TitleBar>
        </div>
      )}

      {/* Progress Bar - hidden on welcome/auth step */}
      {showProgress && (
        <div className="shrink-0 bg-background/80 backdrop-blur-2xl border-b border-white/5 px-6 md:px-12 py-3 z-10">
          <div className="max-w-3xl mx-auto">
            <StepProgress steps={steps.slice(1)} currentStep={currentStep - 1} />
          </div>
        </div>
      )}

      {/* Content - This will grow to fill available space */}
      <div
        className={`flex-1 px-6 md:px-12 overflow-y-auto ${currentStep === 0 ? "flex items-center" : "py-6"}`}
      >
        <div className={`w-full ${currentStep === 0 ? "max-w-sm" : "max-w-3xl"} mx-auto`}>
          <Card className="bg-card/90 backdrop-blur-2xl border border-border/50 dark:border-white/5 shadow-lg rounded-xl overflow-hidden">
            <CardContent className={currentStep === 0 ? "p-6" : "p-6 md:p-8"}>
              {renderStep()}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Footer Navigation - hidden on welcome/auth step */}
      {showProgress && (
        <div className="shrink-0 bg-background/80 backdrop-blur-2xl border-t border-white/5 px-6 md:px-12 py-3 z-10">
          <div className="max-w-3xl mx-auto flex items-center justify-between">
            {/* Hide back button on first step for signed-in users */}
            {!(currentStep === 1 && hasCloudSession && !skipAuth) && (
              <Button
                onClick={prevStep}
                variant="outline"
                disabled={currentStep === 0}
                className="h-8 px-5 rounded-full text-xs"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                {t("common.back")}
              </Button>
            )}

            {/* Spacer to push next button to the right when back button is hidden */}
            {currentStep === 1 && hasCloudSession && !skipAuth && <div />}

            <div className="flex items-center gap-2">
              {currentStep === steps.length - 1 ? (
                <Button
                  onClick={finishOnboarding}
                  disabled={!canProceed()}
                  variant="success"
                  className="h-8 px-6 rounded-full text-xs"
                >
                  <Check className="w-3.5 h-3.5" />
                  {t("common.complete")}
                </Button>
              ) : (
                <Button
                  onClick={nextStep}
                  disabled={!canProceed()}
                  className="h-8 px-6 rounded-full text-xs"
                >
                  {t("common.next")}
                  <ChevronRight className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
