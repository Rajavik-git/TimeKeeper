export function nextCaseReference(year: number, last: number, clientCode: string) {
  const next = last + 1;
  if (next > 999) throw Error("Annual case sequence exhausted");
  return `${year}-${String(next).padStart(3, "0")}-${clientCode}`;
}
