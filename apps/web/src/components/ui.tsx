import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

export function Spinner(): JSX.Element {
  return <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600" role="status" aria-live="polite" />;
}

export function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }): JSX.Element {
  return (
    <label htmlFor={htmlFor} className="block space-y-1">
      <span className="text-sm font-medium text-slate-700">{label}</span>
      {children}
    </label>
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>): JSX.Element {
  return (
    <input
      {...props}
      className={`w-full rounded-lg border border-slate-300 px-3 py-2 text-start focus:border-blue-500 ${props.className ?? ""}`}
    />
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>): JSX.Element {
  return (
    <select
      {...props}
      className={`w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-start focus:border-blue-500 ${props.className ?? ""}`}
    />
  );
}

export function Button({
  children,
  variant = "primary",
  ...props
}: { children: ReactNode; variant?: "primary" | "ghost" } & InputHTMLAttributes<HTMLButtonElement>): JSX.Element {
  const styles =
    variant === "primary"
      ? "bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
      : "bg-transparent text-slate-700 hover:bg-slate-100";
  return (
    <button
      {...(props as Record<string, unknown>)}
      className={`rounded-lg px-4 py-2 font-medium transition ${styles} ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}
