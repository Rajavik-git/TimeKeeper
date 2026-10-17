import { Pill } from "./Pill";
export function Status({
  review_status,
  billing_status,
  billable = true,
  reason = null,
}: {
  review_status: string;
  billing_status: string;
  billable?: boolean;
  reason?: string | null;
}) {
  const reasonLabel =
    (
      {
        offered: "Offered",
        internal: "Internal",
        admin: "Administrative",
      } as Record<string, string>
    )[reason ?? ""] ?? "Non-billable";
  const kind = !billable
    ? "out"
    : billing_status === "billed"
      ? "solid"
      : review_status === "approved"
        ? "ok"
        : "warn";
  const text = !billable
    ? reasonLabel
    : billing_status === "billed"
      ? "Billed"
      : review_status === "approved"
        ? "Approved"
        : "To validate";
  return <Pill kind={kind}>{text}</Pill>;
}
