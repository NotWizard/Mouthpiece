import type { TargetAppInfo } from "../types/electron";

export type SensitiveAppAction =
  | "allow_full_pipeline"
  | "block_cloud_reasoning"
  | "block_paste_monitoring"
  | "block_injection";

export interface SensitiveAppRule {
  id: string;
  label: string;
  appMatchers: RegExp[];
  restrictions: {
    cloudReasoning: boolean;
    pasteMonitoring: boolean;
    injection: boolean;
  };
}

export interface SensitiveAppDecision {
  matched: boolean;
  action: SensitiveAppAction;
  ruleId: string | null;
  label: string | null;
  matchedAppName: string | null;
  blocksCloudReasoning: boolean;
  blocksPasteMonitoring: boolean;
  blocksInjection: boolean;
}

const SENSITIVE_APP_RULES: SensitiveAppRule[] = [
  {
    id: "password_managers",
    label: "Password Managers",
    appMatchers: [/(1password|bitwarden|lastpass|dashlane|keeper|passwords|enpass|keychain)/i],
    restrictions: {
      cloudReasoning: true,
      pasteMonitoring: true,
      injection: true,
    },
  },
  {
    id: "authentication",
    label: "Authentication",
    appMatchers: [/(authy|okta|duo|microsoft authenticator|google authenticator)/i],
    restrictions: {
      cloudReasoning: true,
      pasteMonitoring: true,
      injection: false,
    },
  },
  {
    id: "finance_surfaces",
    label: "Finance And Payments",
    appMatchers: [
      /(bank|broker|paypal|stripe|quickbooks|xero|mint|alipay|支付宝|财务|wise|coinbase|binance|fidelity|schwab)/i,
    ],
    restrictions: {
      cloudReasoning: true,
      pasteMonitoring: true,
      injection: false,
    },
  },
];

function getActionFromRestrictions(
  restrictions: SensitiveAppRule["restrictions"]
): SensitiveAppAction {
  if (restrictions.injection) return "block_injection";
  if (restrictions.pasteMonitoring) return "block_paste_monitoring";
  if (restrictions.cloudReasoning) return "block_cloud_reasoning";
  return "allow_full_pipeline";
}

function emptyDecision(targetApp?: Partial<TargetAppInfo> | null): SensitiveAppDecision {
  return {
    matched: false,
    action: "allow_full_pipeline",
    ruleId: null,
    label: null,
    matchedAppName: targetApp?.appName?.trim?.() || null,
    blocksCloudReasoning: false,
    blocksPasteMonitoring: false,
    blocksInjection: false,
  };
}

export function resolveSensitiveAppPolicy({
  targetApp,
  protectionsEnabled = true,
  allowCloudReasoning = false,
  allowPasteMonitoring = false,
  allowInjection = false,
}: {
  targetApp?: Partial<TargetAppInfo> | null;
  protectionsEnabled?: boolean;
  allowCloudReasoning?: boolean;
  allowPasteMonitoring?: boolean;
  allowInjection?: boolean;
} = {}): SensitiveAppDecision {
  if (!protectionsEnabled) {
    return emptyDecision(targetApp);
  }

  const appName = targetApp?.appName?.trim?.() || "";
  if (!appName) {
    return emptyDecision(targetApp);
  }

  const rule = SENSITIVE_APP_RULES.find((candidate) =>
    candidate.appMatchers.some((matcher) => matcher.test(appName))
  );
  if (!rule) {
    return emptyDecision(targetApp);
  }

  const effectiveRestrictions = {
    cloudReasoning: rule.restrictions.cloudReasoning && !allowCloudReasoning,
    pasteMonitoring: rule.restrictions.pasteMonitoring && !allowPasteMonitoring,
    injection: rule.restrictions.injection && !allowInjection,
  };

  return {
    matched: true,
    action: getActionFromRestrictions(effectiveRestrictions),
    ruleId: rule.id,
    label: rule.label,
    matchedAppName: appName,
    blocksCloudReasoning: effectiveRestrictions.cloudReasoning,
    blocksPasteMonitoring: effectiveRestrictions.pasteMonitoring,
    blocksInjection: effectiveRestrictions.injection,
  };
}
