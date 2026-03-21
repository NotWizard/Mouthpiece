export interface TerminologyMapping {
  source: string;
  target: string;
}

export interface TerminologySuggestion {
  term: string;
  sourceTerm: string;
  source: string;
}

export interface TerminologyProfile {
  hotwords: string[];
  blacklistedTerms: string[];
  homophoneMappings: TerminologyMapping[];
  glossaryTerms: string[];
  pendingSuggestions: TerminologySuggestion[];
}

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

function normalizeSuggestions(values: unknown[] = []): TerminologySuggestion[] {
  const seen = new Set();
  const suggestions: TerminologySuggestion[] = [];

  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    const term = normalizeTerm((value as TerminologySuggestion).term);
    const sourceTerm = normalizeTerm((value as TerminologySuggestion).sourceTerm);
    const source = normalizeTerm((value as TerminologySuggestion).source) || "manual";
    if (!term || !sourceTerm) continue;
    const key = `${term.toLowerCase()}<=${sourceTerm.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    suggestions.push({ term, sourceTerm, source });
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

export function mergeTerminologySuggestions(
  profile: Partial<TerminologyProfile> = {},
  suggestions: TerminologySuggestion[] = []
): TerminologyProfile {
  const normalized = normalizeTerminologyProfile(profile);
  return normalizeTerminologyProfile({
    ...normalized,
    pendingSuggestions: [...normalized.pendingSuggestions, ...suggestions],
  });
}
