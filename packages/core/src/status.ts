import { addDays, diffDays, maxDate, type IsoDate } from "./dates.js";
import type { DutyStatus } from "./enums.js";

export interface RecordRef {
  readonly id: string;
  /** Date the inspection was carried out (any result counts as "performed"). */
  readonly performedOn: IsoDate;
  readonly supersedesId: string | null;
}

export interface DerivedInput {
  readonly today: IsoDate;
  readonly commissionedOn: IsoDate | null;
  /** Effective interval after any per-asset override. */
  readonly intervalDays: number;
  readonly graceDays: number;
  readonly records: readonly RecordRef[];
}

export interface Derived {
  readonly lastCompletedOn: IsoDate | null;
  readonly nextDueOn: IsoDate | null;
  readonly status: DutyStatus;
}

/**
 * A record corrected via `supersedes_id` is evidence of a mistake, not of an
 * inspection; only the survivors count toward the schedule.
 */
export function effectiveRecords<T extends RecordRef>(records: readonly T[]): T[] {
  const superseded = new Set(
    records.map((r) => r.supersedesId).filter((id): id is string => id !== null),
  );
  return records.filter((r) => !superseded.has(r.id));
}

function windowStatus(nextDueOn: IsoDate, today: IsoDate, graceDays: number): DutyStatus {
  const delta = diffDays(nextDueOn, today);
  // Past due but still inside grace stays DUE; grace only defers OVERDUE.
  if (delta < -graceDays) return "OVERDUE";
  if (delta <= 30) return "DUE";
  return "OK";
}

export function computeDerived(input: DerivedInput): Derived {
  const { today, commissionedOn, intervalDays, graceDays } = input;
  const live = effectiveRecords(input.records);
  const lastCompletedOn = maxDate(live.map((r) => r.performedOn));

  if (lastCompletedOn === null) {
    const firstDue = commissionedOn === null ? null : addDays(commissionedOn, intervalDays);
    // Never inspected and the first cycle has lapsed (or cannot be bounded) is
    // its own category — never collapse it into OVERDUE.
    if (firstDue === null || diffDays(firstDue, today) < 0) {
      return { lastCompletedOn: null, nextDueOn: firstDue, status: "NEVER_DONE" };
    }
    return { lastCompletedOn: null, nextDueOn: firstDue, status: windowStatus(firstDue, today, graceDays) };
  }

  const nextDueOn = addDays(lastCompletedOn, intervalDays);
  return { lastCompletedOn, nextDueOn, status: windowStatus(nextDueOn, today, graceDays) };
}
