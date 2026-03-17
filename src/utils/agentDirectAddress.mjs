const DIRECT_ADDRESS_PREFIXES = [
  "hey",
  "hi",
  "ok",
  "okay",
  "嘿",
  "嗨",
  "好",
  "好的",
  "请",
  "麻烦",
];
const CJK_COMMAND_HINTS = [
  "请",
  "帮",
  "把",
  "改",
  "写",
  "翻译",
  "总结",
  "整理",
  "生成",
  "回复",
  "润色",
  "优化",
  "删除",
  "移动",
  "替换",
  "列",
  "改成",
  "转换",
  "告诉",
  "解释",
  "回答",
  "做",
  "算",
  "查",
];
const EN_COMMAND_HINTS = [
  "please",
  "help",
  "rewrite",
  "write",
  "draft",
  "translate",
  "summarize",
  "summarise",
  "make",
  "turn",
  "convert",
  "format",
  "answer",
  "explain",
  "tell",
  "fix",
  "polish",
  "remove",
  "move",
  "replace",
  "list",
  "change",
  "create",
  "generate",
];
const EN_QUESTION_HINTS = [
  "what",
  "how",
  "why",
  "when",
  "where",
  "who",
  "can you",
  "could you",
  "would you",
  "will you",
  "can",
  "could",
  "would",
  "will",
];
const SEPARATOR_PATTERN = String.raw`(?:\s*[:,，：]\s*|\s+)`;
const STRONG_BOUNDARY_PATTERN = String.raw`(?:^|[\n\r]|[.!?,;:，。！？；：]\s*)`;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildAgentDirectAddressPatterns(agentName) {
  const normalizedAgentName = typeof agentName === "string" ? agentName.trim() : "";
  if (!normalizedAgentName) {
    return null;
  }

  const escapedName = escapeRegExp(normalizedAgentName);
  const prefixPattern = `(?:${DIRECT_ADDRESS_PREFIXES.map(escapeRegExp).join("|")})`;

  return {
    prefixed: new RegExp(
      `${STRONG_BOUNDARY_PATTERN}(?:${prefixPattern})${SEPARATOR_PATTERN}${escapedName}${SEPARATOR_PATTERN}`,
      "iu"
    ),
    direct: new RegExp(`${STRONG_BOUNDARY_PATTERN}${escapedName}${SEPARATOR_PATTERN}`, "iu"),
  };
}

function looksLikeAgentCommand(text) {
  const trimmed = typeof text === "string" ? text.trim() : "";
  if (!trimmed) {
    return false;
  }

  const normalized = trimmed.toLowerCase();

  if (EN_COMMAND_HINTS.some((hint) => normalized.startsWith(hint))) {
    return true;
  }

  if (EN_QUESTION_HINTS.some((hint) => normalized.startsWith(hint))) {
    return true;
  }

  if (/^[0-9]+(?:\s*[+\-*/]|\s+(plus|minus|times|divided by)\b)/.test(normalized)) {
    return true;
  }

  if (/^[一二三四五六七八九十零两百千万亿]+(?:加|减|乘|除|等于)/u.test(trimmed)) {
    return true;
  }

  return CJK_COMMAND_HINTS.some((hint) => trimmed.startsWith(hint));
}

export function buildAgentDirectAddressPattern(agentName) {
  const patterns = buildAgentDirectAddressPatterns(agentName);
  if (!patterns) {
    return null;
  }

  return new RegExp(`(?:${patterns.prefixed.source})|(?:${patterns.direct.source})`, "iu");
}

export function hasAgentDirectAddress(text, agentName) {
  const normalizedText = typeof text === "string" ? text.trim() : "";
  if (!normalizedText) {
    return false;
  }

  const patterns = buildAgentDirectAddressPatterns(agentName);
  if (!patterns) {
    return false;
  }

  for (const pattern of [patterns.prefixed, patterns.direct]) {
    const match = pattern.exec(normalizedText);
    if (!match) {
      continue;
    }

    const remainder = normalizedText.slice(match.index + match[0].length).trim();
    if (looksLikeAgentCommand(remainder)) {
      return true;
    }
  }

  return false;
}
