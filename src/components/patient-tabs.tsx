"use client";

import { useState, type ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/icon";

export interface PatientTab {
  id: string;
  label: string;
  icon: IconName;
  content: ReactNode;
}

export function PatientTabs({ tabs }: { tabs: PatientTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id ?? "");
  const current = tabs.find((tab) => tab.id === active) ?? tabs[0];

  return (
    <div className="flex flex-col gap-3">
      <div className="neo-card flex gap-1 overflow-x-auto p-1.5">
        {tabs.map((tab) => {
          const isActive = tab.id === current?.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActive(tab.id)}
              className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-bold whitespace-nowrap transition-colors ${
                isActive ? "bg-ink text-white shadow-tactile-sm" : "text-ink-soft hover:bg-canvas"
              }`}
            >
              <Icon name={tab.icon} size={13} />
              {tab.label}
            </button>
          );
        })}
      </div>
      <div>{current?.content}</div>
    </div>
  );
}
