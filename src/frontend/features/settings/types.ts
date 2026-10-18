import type { ScreenProps } from "../../api/client";

export type SectionProps = Pick<ScreenProps, "catalogState" | "action" | "navigate"> & {
  saved: (operation: Promise<unknown>) => Promise<boolean>;
  notify: (message: string) => void;
};
