export const visibleValue = (value: string | null | undefined): value is string =>
  Boolean(value?.trim());
