/**
 * @typedef {"default" | "destructive" | "success"} ToastVariant
 */

/**
 * @param {{ variant?: ToastVariant; duration?: number }} [input]
 */
export function isToastCloseButtonAlwaysVisible({ variant = "default", duration } = {}) {
  return variant === "destructive" || duration === 0;
}

/**
 * @param {{
 *   showDictationPanel?: (() => void) | null;
 *   toast: (options: {
 *     title?: string;
 *     description?: string;
 *     action?: unknown;
 *     variant?: ToastVariant;
 *     duration?: number;
 *     onClose?: () => void;
 *   }) => string;
 *   options: {
 *     title?: string;
 *     description?: string;
 *     action?: unknown;
 *     variant?: ToastVariant;
 *     duration?: number;
 *     onClose?: () => void;
 *   };
 * }} input
 */
export function presentOverlayToast({ showDictationPanel, toast, options }) {
  showDictationPanel?.();
  return toast(options);
}
