const SENSITIVE_APP_RULES = [
  {
    id: "password_managers",
    label: "Password Managers",
    appMatchers: [/(1password|bitwarden|lastpass|dashlane|keeper|passwords|enpass|keychain)/i],
    restrictions: {
      cloudReasoning: true,
      autoLearn: true,
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
      autoLearn: true,
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
      autoLearn: true,
      pasteMonitoring: true,
      injection: false,
    },
  },
];

function normalizeTargetApp(targetApp) {
  if (!targetApp || typeof targetApp !== "object") {
    return { appName: null, processId: null, platform: null, source: null, capturedAt: null };
  }

  return {
    appName: typeof targetApp.appName === "string" ? targetApp.appName.trim() : null,
    processId: Number.isInteger(targetApp.processId) ? targetApp.processId : null,
    platform: typeof targetApp.platform === "string" ? targetApp.platform : null,
    source: typeof targetApp.source === "string" ? targetApp.source : null,
    capturedAt: typeof targetApp.capturedAt === "string" ? targetApp.capturedAt : null,
  };
}

function getActionFromRestrictions(restrictions) {
  if (restrictions.injection) return "block_injection";
  if (restrictions.pasteMonitoring) return "block_paste_monitoring";
  if (restrictions.cloudReasoning) return "block_cloud_reasoning";
  if (restrictions.autoLearn) return "block_auto_learn";
  return "allow_full_pipeline";
}

function buildDecision(targetApp, rule, restrictions) {
  return {
    matched: Boolean(rule),
    action: getActionFromRestrictions(restrictions),
    ruleId: rule?.id || null,
    label: rule?.label || null,
    matchedAppName: targetApp?.appName || null,
    blocksCloudReasoning: restrictions.cloudReasoning,
    blocksAutoLearn: restrictions.autoLearn,
    blocksPasteMonitoring: restrictions.pasteMonitoring,
    blocksInjection: restrictions.injection,
    targetApp,
  };
}

function resolveSensitiveAppPolicy({
  targetApp,
  protectionsEnabled = true,
  allowCloudReasoning = false,
  allowAutoLearn = false,
  allowPasteMonitoring = false,
  allowInjection = false,
} = {}) {
  const normalizedTargetApp = normalizeTargetApp(targetApp);
  const appName = normalizedTargetApp.appName || "";

  if (!protectionsEnabled || !appName) {
    return buildDecision(normalizedTargetApp, null, {
      cloudReasoning: false,
      autoLearn: false,
      pasteMonitoring: false,
      injection: false,
    });
  }

  const matchedRule =
    SENSITIVE_APP_RULES.find((rule) => rule.appMatchers.some((matcher) => matcher.test(appName))) ||
    null;
  if (!matchedRule) {
    return buildDecision(normalizedTargetApp, null, {
      cloudReasoning: false,
      autoLearn: false,
      pasteMonitoring: false,
      injection: false,
    });
  }

  return buildDecision(normalizedTargetApp, matchedRule, {
    cloudReasoning: matchedRule.restrictions.cloudReasoning && !allowCloudReasoning,
    autoLearn: matchedRule.restrictions.autoLearn && !allowAutoLearn,
    pasteMonitoring: matchedRule.restrictions.pasteMonitoring && !allowPasteMonitoring,
    injection: matchedRule.restrictions.injection && !allowInjection,
  });
}

module.exports = {
  SENSITIVE_APP_RULES,
  resolveSensitiveAppPolicy,
};

module.exports.default = module.exports;
