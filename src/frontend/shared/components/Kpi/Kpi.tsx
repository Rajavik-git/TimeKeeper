import type { ReactNode } from "react";
export function Kpi({
  title,
  value,
  detail,
  dark = false,
}: {
  title: string;
  value: ReactNode;
  detail?: string;
  dark?: boolean;
}) {
  return (
    <div className={`kpi ${dark ? "dark" : ""}`}>
      <span className="small muted">{title}</span>
      <span className="v">{value}</span>
      {detail && <span className="tiny muted">{detail}</span>}
    </div>
  );
}
