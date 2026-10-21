import Link from "next/link";
import type { ReactNode } from "react";
import { Icon } from "@/components/ui/icon";
import { SignOutButton } from "@/components/sign-out-button";
import { ADMIN_NAV, CAREGIVER_NAV } from "./nav-config";
import { MobileNav, SidebarNav } from "./sidebar-nav";

export function AppShell({
  shell,
  displayName,
  roleLabel,
  openCases,
  children,
}: {
  shell: "caregiver" | "admin";
  displayName: string;
  roleLabel: string;
  openCases: number;
  children: ReactNode;
}) {
  const groups = shell === "admin" ? ADMIN_NAV : CAREGIVER_NAV;
  const home = shell === "admin" ? "/admin" : "/dashboard";
  const casesHref = shell === "admin" ? "/admin/cases" : "/cases";
  const searchHref = shell === "admin" ? "/admin/patients" : "/patients";

  return (
    <div className="flex min-h-screen bg-canvas">
      <SidebarNav groups={groups} openCases={openCases} displayName={displayName} roleLabel={roleLabel} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b-[1.5px] border-ink bg-canvas/95 backdrop-blur">
          <div className="flex items-center gap-2 px-3 py-2.5 lg:px-6">
            <form action={searchHref} className="relative min-w-0 flex-1 sm:max-w-sm">
              <Icon
                name="search"
                size={14}
                className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-soft"
              />
              <input
                type="search"
                name="q"
                placeholder="Search patients by name…"
                className="neo-input h-9 w-full pl-8 text-[12px]"
              />
            </form>

            <div className="ml-auto flex items-center gap-1.5">
              <span className="hidden items-center gap-1.5 rounded-full border border-ink bg-white px-2.5 py-1.5 text-[10px] font-bold tracking-wide uppercase md:inline-flex">
                <span className="h-1.5 w-1.5 rounded-full bg-sage-ink" />
                Simulated telephony
              </span>
              <span className="hidden items-center gap-1.5 rounded-full border border-line-soft bg-white px-2.5 py-1.5 text-[10px] font-semibold text-ink-soft xl:inline-flex">
                <Icon name="calendar" size={12} />
                {new Intl.DateTimeFormat("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                }).format(new Date())}
              </span>

              {shell === "admin" ? (
                <Link href="/admin/patients" className="neo-btn neo-btn-dark h-8">
                  <Icon name="plus" size={13} />
                  <span className="hidden sm:inline">New patient</span>
                </Link>
              ) : (
                <Link href="/demo/call-simulator" className="neo-btn neo-btn-dark h-8">
                  <Icon name="phone" size={13} />
                  <span className="hidden sm:inline">Start check-in</span>
                </Link>
              )}

              <Link
                href={casesHref}
                aria-label={`Open escalation cases: ${openCases}`}
                className="relative flex h-8 w-8 items-center justify-center rounded-lg border border-line-soft bg-white"
              >
                <Icon name="bell" size={15} />
                {openCases > 0 ? (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-ink bg-rose px-1 font-display text-[9px] font-bold text-rose-ink">
                    {openCases}
                  </span>
                ) : null}
              </Link>

              <Link href={home} className="hidden items-center gap-2 rounded-lg border border-line-soft bg-white py-1 pr-2.5 pl-1 sm:flex">
                <span className="flex h-6 w-6 items-center justify-center rounded-md border border-ink bg-lilac font-display text-[10px] font-bold text-lilac-ink">
                  {displayName
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((part) => part[0]?.toUpperCase())
                    .join("")}
                </span>
                <span className="leading-tight">
                  <span className="block text-[10px] font-bold">{displayName.split(" ")[0]}</span>
                  <span className="block text-[8px] font-semibold tracking-wider text-ink-muted uppercase">
                    {roleLabel}
                  </span>
                </span>
              </Link>

              <span className="lg:hidden">
                <SignOutButton compact />
              </span>
            </div>
          </div>
        </header>

        <MobileNav groups={groups} openCases={openCases} />

        <main className="mx-auto w-full max-w-[1480px] flex-1 px-3 py-4 lg:px-6 lg:py-6">{children}</main>

        <footer className="mx-auto w-full max-w-[1480px] px-4 pt-2 pb-6 text-center text-[10px] font-medium text-ink-muted">
          Synthetic demo data · all calls, SMS, and notifications are simulated · numbers come from persisted records
        </footer>
      </div>
    </div>
  );
}
