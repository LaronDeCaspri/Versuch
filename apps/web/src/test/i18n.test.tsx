import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ar } from "../i18n/ar.js";
import { en } from "../i18n/en.js";
import { I18nProvider, useI18n } from "../i18n/index.js";
import { DateLabel } from "../components/DateLabel.js";
import { StatusBadge } from "../components/StatusBadge.js";
import { asIsoDate } from "@cmp/core";

describe("i18n catalogue", () => {
  it("English mirrors the Arabic source of truth exactly (no missing/extra keys)", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(ar).sort());
  });

  it("has no empty strings in either catalogue", () => {
    for (const [k, v] of Object.entries(ar)) expect(v, `ar.${k}`).not.toBe("");
    for (const [k, v] of Object.entries(en)) expect(v, `en.${k}`).not.toBe("");
  });
});

function Interp(): JSX.Element {
  const { t } = useI18n();
  return <span>{t("asset.intervalDays", { days: 30 })}</span>;
}

describe("interpolation", () => {
  it("substitutes variables", () => {
    render(
      <I18nProvider>
        <Interp />
      </I18nProvider>,
    );
    expect(screen.getByText("كل 30 يوم")).toBeInTheDocument(); // Arabic is default
  });
});

describe("DateLabel", () => {
  it("shows Gregorian and Hijri together", () => {
    render(
      <I18nProvider>
        <DateLabel date={asIsoDate("2026-07-11")} />
      </I18nProvider>,
    );
    // Gregorian (canonical) plus Um al-Qura Hijri (Arabic-Indic digits under ar).
    expect(screen.getByText(/2026-07-11/)).toBeInTheDocument();
    expect(screen.getByText(/١٤٤٨/)).toBeInTheDocument();
  });

  it("renders an em dash for a null date", () => {
    render(
      <I18nProvider>
        <DateLabel date={null} />
      </I18nProvider>,
    );
    expect(screen.getByText("—")).toBeInTheDocument();
  });
});

describe("StatusBadge", () => {
  it("labels NEVER_DONE distinctly from OVERDUE", () => {
    render(
      <I18nProvider>
        <StatusBadge status="NEVER_DONE" />
        <StatusBadge status="OVERDUE" />
      </I18nProvider>,
    );
    expect(screen.getByText(ar["status.NEVER_DONE"])).toBeInTheDocument();
    expect(screen.getByText(ar["status.OVERDUE"])).toBeInTheDocument();
  });
});
