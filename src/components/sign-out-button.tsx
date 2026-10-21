"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/ui/icon";

export function SignOutButton({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      aria-label="Sign out"
      title="Sign out"
      onClick={async () => {
        setBusy(true);
        await fetch("/api/v1/auth/logout", { method: "POST" });
        router.push("/login");
        router.refresh();
      }}
      className={
        compact
          ? "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-current/30 text-current opacity-60 hover:opacity-100 disabled:opacity-30"
          : "neo-btn h-9"
      }
    >
      {compact ? <Icon name="logout" size={14} /> : busy ? "Signing out…" : "Sign out"}
    </button>
  );
}
