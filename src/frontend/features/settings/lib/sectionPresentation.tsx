import type { KeyboardEvent, ReactNode } from "react";
import type { State } from "../../../api/client";
import { money } from "../../../shared/format";

export const currencyAmount = (state: State, cents: number) =>
  money(cents, state.settings.currency ?? "USD");

export function blurOnEnter(event: KeyboardEvent<HTMLInputElement>) {
  if (event.key === "Enter") event.currentTarget.blur();
}

export function cardHead(title: string, subtitle: string, button?: ReactNode) {
  return (
    <div className="card-h">
      <div className="t">
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      {button}
    </div>
  );
}
