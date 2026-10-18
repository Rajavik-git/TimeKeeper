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
  return (
    <section className={`card card-padded ${className}`} style={style}>
      {children}
    </section>
  );
}
