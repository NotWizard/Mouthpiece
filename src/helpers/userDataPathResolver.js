const fs = require("fs");
const path = require("path");

function buildUserDataDirName(baseName, channel) {
  return channel === "production" ? baseName : `${baseName}-${channel}`;
}

function safeStatSize(filePath) {
  try {
    return fs.statSync(filePath).size || 0;
  } catch {
    return 0;
  }
}

function getDirectoryByteSize(dirPath, depth = 0, maxDepth = 4) {
  if (depth > maxDepth) {
    return 0;
  }

  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return 0;
  }

  let totalBytes = 0;
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      totalBytes += getDirectoryByteSize(entryPath, depth + 1, maxDepth);
      continue;
    }

    if (entry.isFile()) {
      totalBytes += safeStatSize(entryPath);
    }
  }

  return totalBytes;
}

function getChromiumStorageScore(dirPath) {
  const localStorageBytes = getDirectoryByteSize(path.join(dirPath, "Local Storage"));
  const sessionStorageBytes = getDirectoryByteSize(path.join(dirPath, "Session Storage"));
  const indexedDbBytes = getDirectoryByteSize(path.join(dirPath, "IndexedDB"));

  return (
    (localStorageBytes > 2048 ? 6 : localStorageBytes > 128 ? 3 : 0) +
    (sessionStorageBytes > 1024 ? 4 : sessionStorageBytes > 128 ? 2 : 0) +
    (indexedDbBytes > 4096 ? 4 : indexedDbBytes > 512 ? 2 : 0)
  );
}

function getUserDataStateScore(dirPath) {
  return (
    (safeStatSize(path.join(dirPath, ".env")) > 0 ? 8 : 0) +
    (safeStatSize(path.join(dirPath, "transcriptions-dev.db-wal")) > 1024 ? 5 : 0) +
    (safeStatSize(path.join(dirPath, "transcriptions.db-wal")) > 1024 ? 5 : 0) +
    (safeStatSize(path.join(dirPath, "transcriptions-dev.db")) > 4096 ? 3 : 0) +
    (safeStatSize(path.join(dirPath, "transcriptions.db")) > 4096 ? 3 : 0) +
    getChromiumStorageScore(dirPath) +
    (safeStatSize(path.join(dirPath, "Preferences")) > 64 ? 1 : 0)
  );
}

function resolveUserDataPath({
  override = "",
  appDataRoot,
  currentUserDataBaseName,
  legacyUserDataBaseNames = [],
  channel = "production",
} = {}) {
  const normalizedOverride = String(override || "").trim();
  if (normalizedOverride) {
    return { selectedPath: normalizedOverride, reason: "env-override" };
  }

  const candidateNames = [currentUserDataBaseName, ...legacyUserDataBaseNames];
  const candidates = candidateNames.map((baseName) => {
    const dirPath = path.join(appDataRoot, buildUserDataDirName(baseName, channel));

    return {
      baseName,
      dirPath,
      exists: fs.existsSync(dirPath),
      isCurrent: baseName === currentUserDataBaseName,
    };
  });

  const currentCandidate = candidates.find((candidate) => candidate.isCurrent);
  const existingCandidates = candidates.filter((candidate) => candidate.exists);

  if (existingCandidates.length === 0) {
    return { selectedPath: currentCandidate.dirPath, reason: "fresh-current" };
  }

  const rankedCandidates = existingCandidates
    .map((candidate) => ({
      ...candidate,
      score: getUserDataStateScore(candidate.dirPath),
    }))
    .sort((a, b) => {
      if (a.score !== b.score) {
        return b.score - a.score;
      }

      if (a.isCurrent !== b.isCurrent) {
        return a.isCurrent ? -1 : 1;
      }

      return candidateNames.indexOf(a.baseName) - candidateNames.indexOf(b.baseName);
    });

  const selectedCandidate = rankedCandidates[0];

  if (existingCandidates.length === 1) {
    return {
      selectedPath: selectedCandidate.dirPath,
      reason: selectedCandidate.isCurrent
        ? "current-only"
        : `legacy-only:${selectedCandidate.baseName}`,
    };
  }

  return {
    selectedPath: selectedCandidate.dirPath,
    reason: selectedCandidate.isCurrent
      ? "current-higher-or-equal-score"
      : `legacy-higher-score:${selectedCandidate.baseName}`,
  };
}

module.exports = {
  buildUserDataDirName,
  getChromiumStorageScore,
  getUserDataStateScore,
  resolveUserDataPath,
};
