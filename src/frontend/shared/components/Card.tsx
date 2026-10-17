import type { CSSProperties, ReactNode } from "react";
export function Card({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return <section className={`glass pad ${className}`} style={style}>{children}</section>;
}
