const DATE = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const TIME = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "long" });
const SHORT_WEEKDAY = new Intl.DateTimeFormat("en-US", { weekday: "short" });
const MONTH = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return DATE.format(new Date(value));
}

export function formatTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return TIME.format(new Date(value));
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "—";
  return `${DATE.format(new Date(value))} · ${TIME.format(new Date(value))}`;
}

export function weekday(value: string | Date): string {
  return WEEKDAY.format(new Date(value));
}

export function shortWeekday(value: string | Date): string {
  return SHORT_WEEKDAY.format(new Date(value));
}

export function monthLabel(value: Date): string {
  return MONTH.format(value);
}

export function ageFrom(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export function dayKey(value: string | Date): string {
  const d = new Date(value);
  const month = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

export function minutesAgo(value: string | Date): number {
  return Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000));
}

export function humanAgo(value: string | Date): string {
  const minutes = minutesAgo(value);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
