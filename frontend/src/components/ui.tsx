import type { ReactNode } from "react";

type Span = 1 | 2 | 3 | 4 | 5 | 6;

const COL_SPAN: Record<Span, string> = {
  1: "lg:col-span-1",
  2: "lg:col-span-2",
  3: "lg:col-span-3",
  4: "lg:col-span-4",
  5: "lg:col-span-5",
  6: "lg:col-span-6 sm:col-span-2",
};

const ROW_SPAN: Record<1 | 2 | 3, string> = {
  1: "",
  2: "lg:row-span-2",
  3: "lg:row-span-3",
};

/** Bento container: 1 col mobile → 2 col tablet → 6 col desktop. */
export function Bento({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`bento ${className}`}>{children}</div>;
}

/**
 * A bento cell. `span` / `rowSpan` only apply at lg and up so small screens
 * stay a readable single/double column stack.
 */
export function Tile({
  children,
  span = 2,
  rowSpan = 1,
  tone = "default",
  interactive = false,
  className = "",
  padded = true,
}: {
  children: ReactNode;
  span?: Span;
  rowSpan?: 1 | 2 | 3;
  tone?: "default" | "brand";
  interactive?: boolean;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section
      className={[
        "tile",
        tone === "brand" ? "tile-brand" : "",
        interactive ? "tile-interactive" : "",
        COL_SPAN[span],
        ROW_SPAN[rowSpan],
        padded ? "p-4 md:p-5" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </section>
  );
}

export function TileHeader({
  title,
  hint,
  action,
  tone = "default",
}: {
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
  tone?: "default" | "brand";
}) {
  return (
    <header className="mb-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h2
          className={`font-display text-base md:text-lg leading-tight ${
            tone === "brand" ? "text-white" : ""
          }`}
        >
          {title}
        </h2>
        {hint ? (
          <p
            className={`mt-0.5 text-xs ${
              tone === "brand"
                ? "text-white/70"
                : "text-[var(--color-ink-muted)]"
            }`}
          >
            {hint}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  );
}

/** Compact metric readout used inside bento stat tiles. */
export function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "brand";
}) {
  return (
    <div>
      <p
        className={`text-[0.7rem] font-medium uppercase tracking-[0.08em] ${
          tone === "brand" ? "text-white/70" : "text-[var(--color-ink-muted)]"
        }`}
      >
        {label}
      </p>
      <p
        className={`tabular font-display text-2xl md:text-3xl leading-none mt-1.5 ${
          tone === "brand" ? "text-white" : ""
        }`}
      >
        {value}
      </p>
      {sub ? (
        <p
          className={`mt-1 text-xs ${
            tone === "brand" ? "text-white/70" : "text-[var(--color-ink-muted)]"
          }`}
        >
          {sub}
        </p>
      ) : null}
    </div>
  );
}

const BADGE_TONES: Record<string, string> = {
  neutral:
    "bg-[var(--color-sky-wash)] text-[var(--color-brand)] border-[var(--color-line)]",
  ok: "bg-[var(--color-ok-wash)] text-[var(--color-ok)] border-transparent",
  warn: "bg-[var(--color-warn-wash)] text-[var(--color-warn)] border-transparent",
  err: "bg-[var(--color-err-wash)] text-[var(--color-err)] border-transparent",
  brand: "bg-white/15 text-white border-white/25",
};

export function Badge({
  children,
  tone = "neutral",
  testId,
}: {
  children: ReactNode;
  tone?: "neutral" | "ok" | "warn" | "err" | "brand";
  testId?: string;
}) {
  return (
    <span
      data-testid={testId}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[0.7rem] font-medium ${BADGE_TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/** Small status dot for health / binding readouts. */
export function Dot({ tone }: { tone: "ok" | "warn" | "err" | "idle" }) {
  const color =
    tone === "ok"
      ? "var(--color-ok)"
      : tone === "warn"
        ? "var(--color-warn)"
        : tone === "err"
          ? "var(--color-err)"
          : "var(--color-line-strong)";
  return (
    <span
      aria-hidden
      className="inline-block h-2 w-2 rounded-full"
      style={{ background: color }}
    />
  );
}

/**
 * Shared empty state so operations pages never render a bare blank area.
 */
export function EmptyState({
  title,
  body,
  action,
  testId,
}: {
  title: string;
  body: string;
  action?: ReactNode;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className="rounded-[var(--radius-tile)] border border-dashed border-[var(--color-line-strong)] bg-[var(--color-paper)]/60 px-4 py-6 text-center"
    >
      <p className="font-display text-sm">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-xs text-[var(--color-ink-muted)]">
        {body}
      </p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

/**
 * Legacy page container. Pages were built around `Panel`; it now renders as a
 * bento tile so the whole app shares one surface language.
 */
export function Panel({
  title,
  children,
  hint,
  action,
}: {
  title: string;
  children: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="tile p-4 md:p-5">
      <TileHeader title={title} hint={hint} action={action} />
      {children}
    </section>
  );
}
