import { useState, useCallback } from "react";
import { useSettingsStore, selectIsCloudReasoningMode } from "../stores/settingsStore";

interface UseNotesOnboardingReturn {
  isComplete: boolean;
  isLLMConfigured: boolean;
  complete: () => void;
}

export function useNotesOnboarding(): UseNotesOnboardingReturn {
  const useReasoningModel = useSettingsStore((s) => s.useReasoningModel);
  const effectiveModel = useSettingsStore((s) => s.reasoningModel);
  const isCloudReasoning = useSettingsStore(selectIsCloudReasoningMode);

  const [isComplete, setIsComplete] = useState(
    () => localStorage.getItem("notesOnboardingComplete") === "true"
  );

  const isLLMConfigured = isCloudReasoning || (useReasoningModel && !!effectiveModel);

  const complete = useCallback(() => {
    localStorage.setItem("notesOnboardingComplete", "true");
    localStorage.setItem("uploadSetupComplete", "true");
    setIsComplete(true);
  }, []);

  return { isComplete, isLLMConfigured, complete };
}
