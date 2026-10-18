import type { ReactNode } from "react";

export function PageHeader({
  title,
  description,
  actions,
  className = "",
}: {
  title: ReactNode;
  description: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`page-header ${className}`}>
      <div className="t">
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </div>
  );
}
