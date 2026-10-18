export type StateValue<Definition extends Readonly<Record<string, string>>> =
  Definition[keyof Definition];

/** Drizzle requires a nonempty tuple; preserve each named member's literal type. */
export function stateValues<const Definition extends Readonly<Record<string, string>>>(
  definition: Definition,
): readonly [StateValue<Definition>, ...StateValue<Definition>[]] {
  const values = Object.values(definition);
  if (values.length === 0) throw new Error("A state definition must contain a named member.");
  return Object.freeze(values) as readonly [StateValue<Definition>, ...StateValue<Definition>[]];
}

export function isState<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
): value is Values[number] {
  return typeof value === "string" && values.some((allowed) => allowed === value);
}
