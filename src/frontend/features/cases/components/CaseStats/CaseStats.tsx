import type { ReactNode } from "react";
export type CaseStat = [string, string | number, string, ReactNode?, (() => void)?];
export function CaseStats({ items }: { items: CaseStat[] }) {
  const metric = (
    label: string,
    value: string | number,
    detail: string,
    change?: React.ReactNode,
    onClick?: () => void,
  ) => {
    const contents = (
      <>
        <span className="l">{label}</span>
        <span className="metric-value">
          <span className="v">{value}</span>
          {change}
        </span>
        <span className="s">{detail}</span>
      </>
    );
    return onClick ? (
      <button type="button" className="stat case-stat-action" key={label} onClick={onClick}>
        {contents}
      </button>
    ) : (
      <div className="stat" key={label}>
        {contents}
      </div>
    );
  };
  return (
    <div className="stats cases-stats">
      {items.map(([label, value, detail, change, onClick]) =>
        metric(label, value, detail, change, onClick),
      )}
    </div>
  );
}
