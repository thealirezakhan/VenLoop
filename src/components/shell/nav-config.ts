import type { IconName } from "@/components/ui/icon";

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  exact?: boolean;
  badgeKey?: "openCases";
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const CAREGIVER_NAV: NavGroup[] = [
  {
    label: "Operations",
    items: [
      { href: "/dashboard", label: "Overview", icon: "grid", exact: true },
      { href: "/calendar", label: "Care Calendar", icon: "calendar" },
      { href: "/patients", label: "Patients", icon: "users" },
      { href: "/check-ins", label: "Calls & Check-ins", icon: "phone" },
      { href: "/cases", label: "Escalations", icon: "alert", badgeKey: "openCases" },
    ],
  },
  {
    label: "Signals",
    items: [{ href: "/alerts", label: "All Alerts", icon: "bell" }],
  },
  {
    label: "Simulation & Tools",
    items: [{ href: "/demo/call-simulator", label: "Call Simulator", icon: "sparkles" }],
  },
];

export const ADMIN_NAV: NavGroup[] = [
  {
    label: "Operations",
    items: [
      { href: "/admin", label: "Overview", icon: "grid", exact: true },
      { href: "/admin/cases", label: "Escalation Queue", icon: "alert", badgeKey: "openCases" },
      { href: "/admin/patients", label: "Patients", icon: "users" },
      { href: "/admin/caregivers", label: "Caregivers", icon: "stethoscope" },
    ],
  },
  {
    label: "Administration",
    items: [
      { href: "/admin/assignments", label: "Assignments", icon: "clipboard" },
      { href: "/admin/runs", label: "Official Runs", icon: "activity" },
      { href: "/admin/audit", label: "Audit", icon: "history" },
      { href: "/admin/config", label: "Config & Reset", icon: "settings" },
    ],
  },
  {
    label: "Simulation & Tools",
    items: [{ href: "/demo/call-simulator", label: "Call Simulator", icon: "sparkles" }],
  },
];
