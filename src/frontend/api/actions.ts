/** A committed write remains successful even if its following read fails. */
export async function performAction<T>(
  promise: Promise<{ data?: T; error?: unknown }>,
  refresh: () => Promise<void>,
  notify: (message: string) => void,
): Promise<T | undefined> {
  let result: { data?: T; error?: unknown };
  try {
    result = await promise;
    if (result.error) {
      const error = result.error;
      throw Error(
        typeof error === "object" && error && "error" in error
          ? String(error.error)
          : JSON.stringify(error),
      );
    }
  } catch (error) {
    notify(String(error));
    return undefined;
  }
  try {
    await refresh();
  } catch {
    notify("Saved. The displayed data could not refresh. Refresh the view to see your change.");
  }
  return result.data;
}
