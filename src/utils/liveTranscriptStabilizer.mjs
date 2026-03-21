function toCharacters(text) {
  return Array.from(typeof text === "string" ? text : "");
}

function getCommonPrefixLength(leftText, rightText) {
  const leftChars = toCharacters(leftText);
  const rightChars = toCharacters(rightText);
  const maxLength = Math.min(leftChars.length, rightChars.length);

  let index = 0;
  while (index < maxLength && leftChars[index] === rightChars[index]) {
    index += 1;
  }

  return index;
}

export function createLiveTranscriptStabilizerState() {
  return {
    rawText: "",
    frozenText: "",
    semiStableText: "",
    activeText: "",
    displayText: "",
  };
}

export function advanceLiveTranscriptStabilizer(
  state,
  nextText,
  { unstableTailChars = 6 } = {}
) {
  const normalizedText = typeof nextText === "string" ? nextText : "";
  if (!normalizedText) {
    return createLiveTranscriptStabilizerState();
  }

  const previousState =
    state && typeof state === "object"
      ? { ...createLiveTranscriptStabilizerState(), ...state }
      : createLiveTranscriptStabilizerState();

  const previousDisplayText = previousState.displayText || previousState.rawText || "";
  const previousFrozenChars = toCharacters(previousState.frozenText);
  const nextRawChars = toCharacters(normalizedText);
  const safeUnstableTailChars = Math.max(0, Math.floor(unstableTailChars));
  const commonPrefixLength = getCommonPrefixLength(previousDisplayText, normalizedText);
  const nextFrozenLength = Math.max(previousFrozenChars.length, commonPrefixLength - safeUnstableTailChars);
  const frozenText =
    previousState.frozenText +
    nextRawChars.slice(previousFrozenChars.length, nextFrozenLength).join("");
  const displayText = frozenText + nextRawChars.slice(nextFrozenLength).join("");
  const displayChars = toCharacters(displayText);
  const sharedDisplayLength = Math.max(nextFrozenLength, commonPrefixLength);
  const semiStableText = displayChars.slice(nextFrozenLength, sharedDisplayLength).join("");
  const activeText = displayChars.slice(sharedDisplayLength).join("");

  return {
    rawText: displayText,
    frozenText,
    semiStableText,
    activeText,
    displayText,
  };
}

export function commitLiveTranscriptStabilizer(state, committedText) {
  const normalizedCommittedText = typeof committedText === "string" ? committedText : "";
  if (!normalizedCommittedText) {
    return state && typeof state === "object"
      ? { ...createLiveTranscriptStabilizerState(), ...state }
      : createLiveTranscriptStabilizerState();
  }

  const previousState =
    state && typeof state === "object"
      ? { ...createLiveTranscriptStabilizerState(), ...state }
      : createLiveTranscriptStabilizerState();
  const previousFrozenChars = toCharacters(previousState.frozenText);
  const committedChars = toCharacters(normalizedCommittedText);
  const nextFrozenText =
    previousState.frozenText +
    committedChars.slice(previousFrozenChars.length).join("");
  const displayChars = toCharacters(previousState.displayText || previousState.rawText || "");
  const frozenChars = toCharacters(nextFrozenText);
  const displayText = nextFrozenText + displayChars.slice(frozenChars.length).join("");
  const semiStableText = displayChars.slice(frozenChars.length).join("");

  return {
    rawText: displayText,
    frozenText: nextFrozenText,
    semiStableText,
    activeText: "",
    displayText,
  };
}
