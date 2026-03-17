const DIRECT_ADDRESS_PREFIXES = ["hey", "hi", "ok", "okay", "嘿", "嗨", "好", "好的"];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildAgentDirectAddressPattern(agentName) {
  const normalizedAgentName = typeof agentName === "string" ? agentName.trim() : "";
  if (!normalizedAgentName) {
    return null;
  }

  const escapedName = escapeRegExp(normalizedAgentName);
  const prefixPattern = `(?:${DIRECT_ADDRESS_PREFIXES.join("|")})`;

  return new RegExp(
    `^(?:${prefixPattern}\\s+)?${escapedName}(?:\\s*[:,，：]\\s*|\\s+)(?:please\\s+)?`,
    "i"
  );
}

export function hasAgentDirectAddress(text, agentName) {
  const normalizedText = typeof text === "string" ? text.trim() : "";
  if (!normalizedText) {
    return false;
  }

  const pattern = buildAgentDirectAddressPattern(agentName);
  return !!pattern && pattern.test(normalizedText);
}
