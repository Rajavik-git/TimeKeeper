export const unavailableMessage =
  "Could not complete this action. Check that TimeKeeper is available, then try again.";

const actionErrorMessages = {
  "invalid-request": "Check the entered values and try again.",
  "not-found": "This record is no longer available. Refresh the view before trying again.",
  "no-active-session": "No session is active.",
  pending: "This action is not available yet.",
};

export function isApiError(value: unknown): value is { error: string; message?: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof value.error === "string"
  );
}

/** Only application error envelopes supply user-facing details; transport failures stay private. */
export function actionErrorMessage(error: unknown): string {
  if (!isApiError(error)) return unavailableMessage;
  const fallback = Object.entries(actionErrorMessages).find(([code]) => code === error.error)?.[1];
  if (!fallback) return unavailableMessage;
  const message = typeof error.message === "string" ? error.message.trim() : "";
  if (!message) return fallback;
  const sentence = message[0]!.toUpperCase() + message.slice(1);
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}
