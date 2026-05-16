export interface TerminologyMapping {
  source: string;
  target: string;
}

export interface TerminologyProfile {
  preferredTerms: string[];
  blacklistedTerms: string[];
  homophoneMappings: TerminologyMapping[];
  glossaryTerms: string[];
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

export function createEmptyTerminologyProfile(): TerminologyProfile {
  return {
    preferredTerms: [],
    blacklistedTerms: [],
    homophoneMappings: [],
    glossaryTerms: [],
  };
}

export function normalizeTerminologyProfile(
  value: Partial<TerminologyProfile> = {}
): TerminologyProfile {
  const legacyPreferredTerms = (value as Record<string, unknown>)["hot" + "words"];
  const preferredTerms = Array.isArray(value.preferredTerms)
    ? value.preferredTerms
    : Array.isArray(legacyPreferredTerms)
      ? legacyPreferredTerms
      : [];

  return {
    preferredTerms: dedupeTerms(preferredTerms),
    blacklistedTerms: dedupeTerms(
      Array.isArray(value.blacklistedTerms) ? value.blacklistedTerms : []
    ),
    homophoneMappings: normalizeMappings(
      Array.isArray(value.homophoneMappings) ? value.homophoneMappings : []
    ),
    glossaryTerms: dedupeTerms(Array.isArray(value.glossaryTerms) ? value.glossaryTerms : []),
  };
}

export function terminologyProfileToDictionary(
  profile: Partial<TerminologyProfile> = {}
): string[] {
  const normalized = normalizeTerminologyProfile(profile);
  return dedupeTerms([...normalized.preferredTerms, ...normalized.glossaryTerms]);
}
