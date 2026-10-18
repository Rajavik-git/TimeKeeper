import type { ReactNode } from "react";
export function Pill({
  children,
  kind = "out",
}: {
  children: ReactNode;
  kind?: "out" | "ok" | "warn" | "solid";
}) {
  return <span className={`pill p-${kind}`}>{children}</span>;
}
