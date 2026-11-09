import type { ReadingStatus } from "./types";

const STATUSES: ReadingStatus[] = ["unread", "in_progress", "read"];

export function isReadingStatus(value: unknown): value is ReadingStatus {
  return typeof value === "string" && STATUSES.includes(value as ReadingStatus);
}

export function transitionStatus(
  current: ReadingStatus,
  next: ReadingStatus
): ReadingStatus {
  if (!isReadingStatus(next)) {
    throw new Error(`Unsupported reading status: ${String(next)}`);
  }
  return current === next ? current : next;
}

export function statusAfterActivity(
  status: ReadingStatus,
  activeSeconds: number
): ReadingStatus {
  return status === "unread" && activeSeconds >= 15 ? "in_progress" : status;
}
