const MACOS_ACCESSIBILITY_BUNDLE_ID = "com.mouthpiece.app";

function buildMacOSAccessibilityResetCommand(
  bundleId = MACOS_ACCESSIBILITY_BUNDLE_ID,
  service = "Accessibility"
) {
  return {
    command: "tccutil",
    args: ["reset", service, bundleId],
  };
}

module.exports = {
  MACOS_ACCESSIBILITY_BUNDLE_ID,
  buildMacOSAccessibilityResetCommand,
};
