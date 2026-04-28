import {
  createEmptyTerminologyProfile,
  normalizeTerminologyProfile,
  type TerminologyProfile,
} from "./terminologyProfile";

export function migrateLegacyDictionaryToTerminologyProfile(
  legacyDictionary: string[] = []
): TerminologyProfile {
  return normalizeTerminologyProfile({
    ...createEmptyTerminologyProfile(),
    preferredTerms: Array.isArray(legacyDictionary) ? legacyDictionary : [],
  });
}

export function migrateStoredTerminologyProfile(
  storedProfile: Partial<TerminologyProfile> | null | undefined,
  legacyDictionary: string[] = []
): TerminologyProfile {
  const normalizedStored = normalizeTerminologyProfile(storedProfile || {});

  if (normalizedStored.preferredTerms.length > 0 || normalizedStored.glossaryTerms.length > 0) {
    return normalizedStored;
  }

  if (Array.isArray(legacyDictionary) && legacyDictionary.length > 0) {
    return migrateLegacyDictionaryToTerminologyProfile(legacyDictionary);
  }

  return normalizedStored;
}
