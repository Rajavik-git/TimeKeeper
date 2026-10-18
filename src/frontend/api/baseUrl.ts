/** Desktop requests stay on loopback. Browser development uses Vite's relative API proxy. */
export function applicationApiBaseUrl(desktop: boolean, configured?: string): string {
  if (!desktop) return "";
  const url = new URL(configured || "http://127.0.0.1:8787");
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  )
    throw new Error("VITE_TIMEKEEPER_API_URL must be a local HTTP origin.");
  return url.origin;
}
