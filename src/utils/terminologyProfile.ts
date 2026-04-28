export interface TerminologyMapping {
  source: string;
  target: string;
}

export interface TerminologySuggestion {
  term: string;
  sourceTerm: string;
  source: string;
  createdAt?: number;
}

export interface TerminologyProfile {
  hotwords: string[];
  blacklistedTerms: string[];
  homophoneMappings: TerminologyMapping[];
  glossaryTerms: string[];
  pendingSuggestions: TerminologySuggestion[];
}

export const TERMINOLOGY_PENDING_SUGGESTION_TTL_MS = 24 * 60 * 60 * 1000;

function normalizeTerm(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ");
}

function dedupeTerms(values: unknown[] = []): string[] {
  const seen = new Set();
  const normalized = [];

  for (const value of values) {
    const term = normalizeTerm(value);
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(term);
  }

  return normalized;
}

function normalizeMappings(values: unknown[] = []): TerminologyMapping[] {
  const seen = new Set();
  const mappings: TerminologyMapping[] = [];

  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    const source = normalizeTerm((value as TerminologyMapping).source);
    const target = normalizeTerm((value as TerminologyMapping).target);
    if (!source || !target) continue;
    const key = `${source.toLowerCase()}=>${target.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    mappings.push({ source, target });
  }

  return mappings;
}

function normalizeCreatedAt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const numericValue = Number(value);
    if (Number.isFinite(numericValue) && numericValue > 0) {
      return numericValue;
    }

    const parsedDate = Date.parse(value);
    if (Number.isFinite(parsedDate) && parsedDate > 0) {
      return parsedDate;
    }
  }

  return fallback;
}

function normalizeSuggestions(values: unknown[] = []): TerminologySuggestion[] {
  const seen = new Set();
  const suggestions: TerminologySuggestion[] = [];
  const fallbackCreatedAt = Date.now();

  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    const term = normalizeTerm((value as TerminologySuggestion).term);
    const sourceTerm = normalizeTerm((value as TerminologySuggestion).sourceTerm);
    const source = normalizeTerm((value as TerminologySuggestion).source) || "manual";
    if (!term || !sourceTerm) continue;
    const key = `${term.toLowerCase()}<=${sourceTerm.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push({
      term,
      sourceTerm,
      source,
      createdAt: normalizeCreatedAt((value as TerminologySuggestion).createdAt, fallbackCreatedAt),
    });
  }

  return suggestions;
}

export function createEmptyTerminologyProfile(): TerminologyProfile {
  return {
    hotwords: [],
    blacklistedTerms: [],
    homophoneMappings: [],
    glossaryTerms: [],
    pendingSuggestions: [],
  };
}

export function normalizeTerminologyProfile(
  value: Partial<TerminologyProfile> = {}
): TerminologyProfile {
  return {
    hotwords: dedupeTerms(Array.isArray(value.hotwords) ? value.hotwords : []),
    blacklistedTerms: dedupeTerms(
      Array.isArray(value.blacklistedTerms) ? value.blacklistedTerms : []
    ),
    homophoneMappings: normalizeMappings(
      Array.isArray(value.homophoneMappings) ? value.homophoneMappings : []
    ),
    glossaryTerms: dedupeTerms(Array.isArray(value.glossaryTerms) ? value.glossaryTerms : []),
    pendingSuggestions: normalizeSuggestions(
      Array.isArray(value.pendingSuggestions) ? value.pendingSuggestions : []
    ),
  };
}

export function terminologyProfileToDictionary(
  profile: Partial<TerminologyProfile> = {}
): string[] {
  const normalized = normalizeTerminologyProfile(profile);
  return dedupeTerms([...normalized.hotwords, ...normalized.glossaryTerms]);
}

export function pruneExpiredTerminologySuggestions(
  profile: Partial<TerminologyProfile> = {},
  now = Date.now(),
  ttlMs = TERMINOLOGY_PENDING_SUGGESTION_TTL_MS
): TerminologyProfile {
  const normalized = normalizeTerminologyProfile(profile);
  const safeNow = Number.isFinite(now) ? now : Date.now();
  const safeTtlMs =
    Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : TERMINOLOGY_PENDING_SUGGESTION_TTL_MS;

  return normalizeTerminologyProfile({
    ...normalized,
    pendingSuggestions: normalized.pendingSuggestions.filter((suggestion) => {
      const createdAt = normalizeCreatedAt(suggestion.createdAt, safeNow);
      return safeNow - createdAt <= safeTtlMs;
    }),
  });
}

export function mergeTerminologySuggestions(
  profile: Partial<TerminologyProfile> = {},
  suggestions: TerminologySuggestion[] = []
): TerminologyProfile {
  const now = Date.now();
  const normalized = pruneExpiredTerminologySuggestions(profile, now);
  return pruneExpiredTerminologySuggestions(
    {
      ...normalized,
      pendingSuggestions: [...normalized.pendingSuggestions, ...suggestions],
    },
    now
  );
}
