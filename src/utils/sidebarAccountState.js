/**
 * @typedef {Object} SidebarAccountState
 * @property {boolean} [isSignedIn]
 * @property {string | null | undefined} [userName]
 * @property {string | null | undefined} [userEmail]
 */

function normalizeIdentityValue(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Hide the sidebar account footer entirely when the app is signed out.
 * @param {SidebarAccountState} state
 */
export function shouldShowSidebarAccountSection({ isSignedIn = false, userName, userEmail } = {}) {
  if (!isSignedIn) {
    return false;
  }

  return Boolean(normalizeIdentityValue(userName) || normalizeIdentityValue(userEmail));
}

export default {
  shouldShowSidebarAccountSection,
};
