export type AssignmentRow = Record<string, unknown>;

export interface AssignmentPort {
  transaction<T>(work: () => T): T;
  timeEntry(id: number): AssignmentRow | undefined;
  updateTimeEntry(id: number, values: AssignmentRow): AssignmentRow;
  updateBlock(id: number, values: AssignmentRow): AssignmentRow;
  audit(
    action: string,
    before: string,
    after: string,
    entryId: number,
    blockId: number | null,
    actor?: string,
  ): void;
}
