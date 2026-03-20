function toCharacters(text) {
  return Array.from(typeof text === "string" ? text : "");
}

function isSlidingWindowAdvance(renderedCharacters, targetCharacters) {
  if (
    renderedCharacters.length < 2 ||
    renderedCharacters.length !== targetCharacters.length
  ) {
    return false;
  }

  for (let shift = 1; shift < renderedCharacters.length; shift += 1) {
    let matches = true;

    for (let index = shift; index < renderedCharacters.length; index += 1) {
      if (renderedCharacters[index] !== targetCharacters[index - shift]) {
        matches = false;
        break;
      }
    }

    if (matches) {
      return true;
    }
  }

  return false;
}

export function getLiveTranscriptRevealBase({ renderedText = "", targetText = "" } = {}) {
  if (!targetText) {
    return "";
  }

  const renderedCharacters = toCharacters(renderedText);
  const targetCharacters = toCharacters(targetText);
  const maxPrefixLength = Math.min(renderedCharacters.length, targetCharacters.length);

  let prefixLength = 0;
  while (
    prefixLength < maxPrefixLength &&
    renderedCharacters[prefixLength] === targetCharacters[prefixLength]
  ) {
    prefixLength += 1;
  }

  if (
    prefixLength === 0 &&
    renderedCharacters.length > 0 &&
    isSlidingWindowAdvance(renderedCharacters, targetCharacters)
  ) {
    return targetText;
  }

  return targetCharacters.slice(0, prefixLength).join("");
}

export function stepLiveTranscriptReveal({
  renderedText = "",
  targetText = "",
  maxCharsPerStep = 1,
} = {}) {
  if (!targetText) {
    return "";
  }

  const stepSize = Math.max(1, Math.floor(maxCharsPerStep));
  const targetCharacters = toCharacters(targetText);
  const baseText = getLiveTranscriptRevealBase({ renderedText, targetText });
  const baseCharacters = toCharacters(baseText);

  if (baseCharacters.length >= targetCharacters.length) {
    return targetText;
  }

  return targetCharacters.slice(0, baseCharacters.length + stepSize).join("");
}
