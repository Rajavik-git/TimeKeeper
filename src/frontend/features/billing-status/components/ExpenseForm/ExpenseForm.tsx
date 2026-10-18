import { expenseTypeLabels } from "../../../../shared/presentation/billing";
import { ExpenseType } from "../../../../../contracts/states.generated";
import { useState } from "react";
import { api, type ScreenProps } from "../../../../api/client";
import { useToday } from "../../../../shared/hooks/useToday";

type Props = Pick<ScreenProps, "action"> & {
  caseId: string;
  currency: string;
  close: () => void;
  notify: (message: string) => void;
  busy: boolean;
  setBusy: (busy: boolean) => void;
};
export function ExpenseForm({
  caseId,
  currency,
  action,
  close,
  notify: setNotice,
  busy,
  setBusy,
}: Props) {
  const today = useToday();
  const [expenseLabel, setExpenseLabel] = useState("");
  const [expenseType, setExpenseType] = useState<ExpenseType>(ExpenseType.Expense);
  const [expenseAmount, setExpenseAmount] = useState("");
  return (
    <form
      className="card-b row billing-cost-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        const cents = Math.round(Number(expenseAmount) * 100);
        if (!Number.isSafeInteger(cents) || cents <= 0) {
          setNotice("Enter a valid cost amount.");
          return;
        }
        setBusy(true);
        setNotice("Adding cost…");
        try {
          const result = await action(
            api.POST("/api/billing/expenses", {
              body: {
                caseId: String(caseId),
                date: today,
                label: expenseLabel,
                type: expenseType,
                amountCents: cents,
              },
            }),
          );
          if (result) {
            setExpenseLabel("");
            setExpenseAmount("");
            close();
            setNotice("Cost added");
          } else setNotice("Could not add cost.");
        } catch {
          setNotice("Could not add cost. Please try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <input
        className="field grow"
        disabled={busy}
        placeholder="Cost description"
        aria-label="Cost description"
        required
        value={expenseLabel}
        onChange={(event) => setExpenseLabel(event.target.value)}
      />
      <select
        className="field"
        disabled={busy}
        value={expenseType}
        aria-label="Cost type"
        onChange={(event) => {
          const selected = Object.values(ExpenseType).find(
            (value) => value === event.currentTarget.value,
          );
          if (selected !== undefined) setExpenseType(selected);
        }}
      >
        {Object.values(ExpenseType).map((type) => (
          <option key={type} value={type}>
            {expenseTypeLabels[type]}
          </option>
        ))}
      </select>
      <input
        className="field num"
        disabled={busy}
        type="number"
        min="0.01"
        step="0.01"
        placeholder="0.00"
        aria-label={`Amount in ${currency}`}
        required
        value={expenseAmount}
        onChange={(event) => setExpenseAmount(event.target.value)}
      />
      <button className="btn primary" disabled={busy}>
        {busy ? (
          <>
            <span className="billing-spinner" aria-hidden="true" />
            Adding…
          </>
        ) : (
          "Add"
        )}
      </button>
    </form>
  );
}
