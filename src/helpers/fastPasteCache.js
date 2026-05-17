"use strict";

const DEFAULT_TTL_MS = 60_000;

function createFastPasteCache({ ttlMs = DEFAULT_TTL_MS, clock = Date.now } = {}) {
  let unavailableUntil = 0;

  return {
    isUnavailable() {
      return clock() < unavailableUntil;
    },
    markUnavailable() {
      unavailableUntil = clock() + ttlMs;
    },
    invalidate() {
      unavailableUntil = 0;
    },
  };
}

module.exports = { createFastPasteCache };
