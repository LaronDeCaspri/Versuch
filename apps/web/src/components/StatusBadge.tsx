import { AUTHORITY, type Authority, type Criticality, type DutyStatus } from "@cmp/core";
import { useI18n } from "../i18n/index.js";

const STATUS_STYLES: Record<DutyStatus, string> = {
  OVERDUE: "bg-overdue text-white",
  NEVER_DONE: "bg-neverdone text-white",
  DUE: "bg-due text-white",
  OK: "bg-ok text-white",
};

/** Maps a duty status to its brand colour and localised label. Shared by all status views. */
export function StatusBadge({ status }: { status: DutyStatus }): JSX.Element {
  const { t } = useI18n();
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[status]}`}
    >
      {t(`status.${status}`)}
    </span>
  );
}

const CRITICALITY_STYLES: Record<Criticality, string> = {
  LIFE_SAFETY: "border-overdue text-overdue",
  OPERATIONAL: "border-due text-due",
  NON_CRITICAL: "border-slate-300 text-slate-600",
};

/** Maps an asset criticality to an outlined badge with a localised label. */
export function CriticalityBadge({ criticality }: { criticality: Criticality }): JSX.Element {
  const { t } = useI18n();
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${CRITICALITY_STYLES[criticality]}`}
    >
      {t(`criticality.${criticality}`)}
    </span>
  );
}

function isAuthority(value: string): value is Authority {
  return (AUTHORITY as readonly string[]).includes(value);
}

/** Renders a localised authority name, falling back to the raw value for unknown codes. */
export function AuthorityLabel({ authority }: { authority: string }): JSX.Element {
  const { t } = useI18n();
  return <>{isAuthority(authority) ? t(`authority.${authority}`) : authority}</>;
}
