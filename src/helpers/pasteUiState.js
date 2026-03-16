function shouldRestoreDictationPanelAfterPaste(result, options = {}) {
  if (options?.suppressDictationPanelRestore) {
    return false;
  }

  return result?.mode === "copied" || result?.mode === "failed";
}

module.exports = {
  shouldRestoreDictationPanelAfterPaste,
};
