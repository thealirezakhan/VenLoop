import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/icon";
import { initials } from "@/lib/format";

export type Tone = "white" | "sage" | "sky" | "butter" | "rose" | "lilac" | "sand" | "dark";

const TONE_SURFACE: Record<Tone, string> = {
  white: "bg-white",
  sage: "bg-sage",
  sky: "bg-sky",
  butter: "bg-butter",
  rose: "bg-rose",
  lilac: "bg-lilac",
  sand: "bg-sand",
  dark: "bg-ink text-white",
};

const TONE_INK: Record<Tone, string> = {
  white: "text-ink",
  sage: "text-sage-ink",
  sky: "text-sky-ink",
  butter: "text-butter-ink",
  rose: "text-rose-ink",
  lilac: "text-lilac-ink",
  sand: "text-sand-ink",
  dark: "text-white",
};

export function statusTone(status: string | null | undefined): Tone {
  const value = (status ?? "").toLowerCase();
  if (["completed", "taken", "passed", "resolved_reported", "granted", "notified", "active", "acknowledged"].includes(value)) {
    return "sage";
  }
  if (["escalated", "urgent", "failed", "critical", "symptom", "emergency", "unreachable"].includes(value)) {
    return "rose";
  }
  if (["pending", "awaiting", "unknown", "scheduled", "follow_up_in_progress", "in_progress", "paused"].includes(value)) {
    return "butter";
  }
  if (["open", "detected", "new"].includes(value)) return "sky";
  return "white";
}

export function Badge({
  children,
  tone = "white",
  className = "",
}: {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span className={`neo-chip ${TONE_SURFACE[tone]} ${TONE_INK[tone]} ${className}`}>
      {children}
    </span>
  );
}

export function StatusBadge({ status, prefix }: { status: string | null | undefined; prefix?: string }) {
  if (!status) return null;
  return (
    <Badge tone={statusTone(status)}>
      {prefix ? `${prefix} · ` : ""}
      {status.replaceAll("_", " ")}
    </Badge>
  );
}

export function Avatar({
  name,
  size = 40,
  tone = "sage",
  className = "",
}: {
  name: string;
  size?: number;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-xl border-[1.5px] border-ink font-display font-bold ${TONE_SURFACE[tone]} ${TONE_INK[tone]} ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(11, Math.round(size / 3)) }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = "white",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: IconName;
  tone?: Tone;
}) {
  return (
    <div className={`neo-card p-4 shadow-tactile-sm ${TONE_SURFACE[tone]}`}>
      <div className="flex items-start justify-between gap-2">
        <span className={`neo-eyebrow ${tone === "dark" ? "text-white/70" : ""}`}>{label}</span>
        {icon ? (
          <span
            className={`flex h-7 w-7 items-center justify-center rounded-lg border border-ink/20 ${tone === "white" ? "bg-canvas" : "bg-white/60"}`}
          >
            <Icon name={icon} size={14} />
          </span>
        ) : null}
      </div>
      <div className="mt-2 font-display text-[30px] leading-none font-bold">{value}</div>
      {hint ? (
        <div className={`mt-2 text-[11px] font-medium ${tone === "dark" ? "text-white/70" : "text-ink-soft"}`}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
  aside,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow ? <div className="neo-eyebrow mb-1">{eyebrow}</div> : null}
        <h1 className="font-display text-[26px] leading-tight font-bold lg:text-[30px]">{title}</h1>
        {subtitle ? <div className="mt-1.5 max-w-2xl text-[13px] text-ink-soft">{subtitle}</div> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {aside}
        {actions}
      </div>
    </header>
  );
}

export function SectionCard({
  title,
  eyebrow,
  action,
  children,
  className = "",
  tone = "white",
  bodyClassName = "p-4",
}: {
  title?: string;
  eyebrow?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: Tone;
  bodyClassName?: string;
}) {
  return (
    <section className={`neo-card overflow-hidden ${TONE_SURFACE[tone]} ${className}`}>
      {title || action ? (
        <div className="flex items-center justify-between gap-3 border-b-[1.5px] border-ink px-4 py-3">
          <div>
            {eyebrow ? <div className="neo-eyebrow mb-0.5">{eyebrow}</div> : null}
            {title ? <h2 className="font-display text-[13px] font-bold tracking-tight">{title}</h2> : null}
          </div>
          {action}
        </div>
      ) : null}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-ink/25 bg-white/60 px-4 py-6 text-center text-[12px] text-ink-soft">
      {children}
    </div>
  );
}

export function Bar({ value, max, tone = "sage" }: { value: number; max: number; tone?: Tone }) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  const fill: Record<string, string> = {
    sage: "bg-sage-ink",
    rose: "bg-rose-ink",
    sky: "bg-sky-ink",
    butter: "bg-butter-ink",
    lilac: "bg-lilac-ink",
    sand: "bg-sand-ink",
    dark: "bg-ink",
    white: "bg-ink",
  };
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-ink/10">
      <div className={`h-full rounded-full ${fill[tone] ?? fill.sage}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
