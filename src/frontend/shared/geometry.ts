// Register measured geometry as reusable CSS classes; theme colors stay in theme.css.
const classes = new Map<
  string,
  { name: string; index: number; body: string }
>();
let sheet: CSSStyleSheet | undefined;

export function geometryClass(
  declarations: Record<string, string | number>,
  key?: string,
): string {
  const body = Object.entries(declarations)
    .map(([name, value]) => `${name}:${value}`)
    .join(";");
  const cacheKey = key ?? body;
  const existing = classes.get(cacheKey);
  if (existing?.body === body) return existing.name;
  if (!sheet) {
    const element = document.createElement("style");
    element.dataset.geometry = "";
    document.head.append(element);
    sheet = element.sheet!;
  }
  const name = existing?.name ?? `geometry-${classes.size}`;
  const index = existing?.index ?? sheet.cssRules.length;
  if (existing) sheet.deleteRule(index);
  sheet.insertRule(`.${name}{${body}}`, index);
  classes.set(cacheKey, { name, index, body });
  return name;
}
