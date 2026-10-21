"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/components/ui/icon";
import { SignOutButton } from "@/components/sign-out-button";
import type { NavGroup } from "./nav-config";

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function BadgeCount({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="ml-auto rounded-full bg-rose px-1.5 py-0.5 font-display text-[10px] font-bold text-rose-ink">
      {count}
    </span>
  );
}

export function SidebarNav({
  groups,
  openCases,
  displayName,
  roleLabel,
}: {
  groups: NavGroup[];
  openCases: number;
  displayName: string;
  roleLabel: string;
}) {
  const pathname = usePathname();

  return (
    <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col bg-butten text-ink-muted lg:flex">
      <Link href={groups[0]?.items[0]?.href ?? "/"} className="flex items-center gap-3 border-b border-black/10 px-5 py-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-black/25 bg-white font-display text-[13px] font-bold text-ink">
          VL
        </span>
        <span>
          <span className="block font-display text-[15px] leading-tight font-bold tracking-tight">VenLoop</span>
          <span className="block text-[9px] font-semibold tracking-[0.16em] text-ink-muted uppercase">
            {roleLabel}
          </span>
        </span>
      </Link>

      <nav className="flex-1 overflow-y-auto px-3 py-4">
        {groups.map((group) => (
          <div key={group.label} className="mb-5">
            <div className="px-3 pb-2 text-[9px] font-bold tracking-[0.16em] text-ink-muted uppercase">
              {group.label}
            </div>
            <ul className="space-y-0.5">
              {group.items.map((item) => {
                const active = isActive(pathname, item.href, item.exact);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[12.5px] transition-colors ${
                        active
                          ? "bg-white font-bold text-ink shadow-tactile-sm"
                          : "font-medium text-black/60 hover:bg-white/5 hover:text-black"
                      }`}
                    >
                      <Icon name={item.icon} size={15} />
                      <span className="truncate">{item.label}</span>
                      {item.badgeKey === "openCases" ? <BadgeCount count={openCases} /> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-black/10 p-3">
        <div className="flex items-center gap-2.5 rounded-lg px-2 py-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-black/20 bg-sidebar-raised text-[11px] font-bold">
            {displayName
              .split(/\s+/)
              .slice(0, 2)
              .map((part) => part[0]?.toUpperCase())
              .join("")}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[11.5px] font-semibold text-black">{displayName}</span>
            <span className="block truncate text-[9px] tracking-wide text-black/40 uppercase">{roleLabel}</span>
          </span>
          <SignOutButton compact />
        </div>
      </div>
    </aside>
  );
}

export function MobileNav({ groups, openCases }: { groups: NavGroup[]; openCases: number }) {
  const pathname = usePathname();
  const items = groups.flatMap((group) => group.items);

  return (
    <nav className="flex gap-1.5 overflow-x-auto border-b border-line-soft bg-white px-3 py-2 lg:hidden">
      {items.map((item) => {
        const active = isActive(pathname, item.href, item.exact);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold ${
              active ? "border-ink bg-ink text-black" : "border-line-soft bg-white text-ink-soft"
            }`}
          >
            <Icon name={item.icon} size={13} />
            {item.label}
            {item.badgeKey === "openCases" && openCases > 0 ? (
              <span className="rounded-full bg-rose px-1.5 text-[10px] text-rose-ink">{openCases}</span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
