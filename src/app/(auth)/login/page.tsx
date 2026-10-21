"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/icon";

const DEMO_ACCOUNTS = [
  { role: "Care coordinator", email: "caregiver.a@venloop.demo", tone: "bg-sage" },
  { role: "Care coordinator", email: "caregiver.b@venloop.demo", tone: "bg-sky" },
  { role: "Super admin", email: "admin@venloop.demo", tone: "bg-lilac" },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    setBusy(false);
    if (!res.ok) {
      const body = (await res.json()) as { error?: { message?: string } };
      setError(body.error?.message ?? "Sign in failed.");
      return;
    }
    // Separate shells by role: super-admins land in the admin console.
    const nextParam = new URLSearchParams(window.location.search).get("next");
    let target = nextParam || "/dashboard";
    if (!nextParam) {
      const me = (await fetch("/api/v1/me").then((r) => r.json())) as { data?: { role?: string } };
      if (me.data?.role === "super_admin") target = "/admin";
    }
    router.push(target);
    router.refresh();
  }

  return (
    <main className="grid min-h-screen bg-canvas lg:grid-cols-[minmax(0,1fr)_460px]">
      <section className="flex flex-col justify-between bg-ink p-6 text-white lg:p-10">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-sage text-sage-ink">
            <Icon name="heart" size={16} />
          </span>
          <span className="font-display text-[18px] font-bold">
            Ven<span className="text-sage">Loop</span>
          </span>
          <span className="rounded-full border border-white/20 px-2 py-0.5 text-[8.5px] font-bold tracking-wide uppercase">
            demo environment
          </span>
        </div>

        <div className="my-8 max-w-lg">
          <h2 className="font-display text-[30px] leading-[1.15] font-bold">
            Warm check-ins.
            <br />
            <span className="text-sage">Real escalation paths.</span>
          </h2>
          <p className="mt-3 max-w-md text-[12px] leading-relaxed text-white/70">
            VenLoop places simulated medication check-in calls, records self-reported adherence, and opens an
            acknowledged escalation case when a patient reports symptoms.
          </p>
          <ul className="mt-5 grid gap-2 text-[11px] text-white/80">
            {[
              { icon: "shield" as const, text: "Dosage advice is blocked by policy — always." },
              { icon: "alert" as const, text: "Emergency guidance is never gated behind a call flow." },
              { icon: "file" as const, text: "Every decision is persisted with an evidence trail." },
              { icon: "phoneOff" as const, text: "No real calls, SMS, or emails are ever sent." },
            ].map((item) => (
              <li key={item.text} className="flex items-start gap-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border border-white/20 bg-white/5">
                  <Icon name={item.icon} size={11} />
                </span>
                {item.text}
              </li>
            ))}
          </ul>
        </div>

        <p className="max-w-md text-[9.5px] leading-relaxed text-white/40">
          Synthetic patient data only. Not a medical device. Never enter real personal health information.
        </p>
      </section>

      <section className="flex items-center justify-center p-5 lg:p-8">
        <div className="w-full max-w-sm">
          <div className="neo-card p-5">
            <div className="neo-eyebrow">Caregiver console</div>
            <h1 className="font-display text-[24px] font-bold">VenLoop sign in</h1>
            <p className="mt-1 text-[11px] text-ink-soft">
              Demo accounts only — caregivers and super-admins. Synthetic data.
            </p>

            <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-[10px] font-bold uppercase">
                Email
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="neo-input"
                  autoComplete="username"
                  placeholder="caregiver.a@venloop.demo"
                />
              </label>
              <label className="flex flex-col gap-1 text-[10px] font-bold uppercase">
                Password
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="neo-input"
                  autoComplete="current-password"
                  placeholder="venloop-demo-123"
                />
              </label>
              {error ? (
                <p role="alert" className="rounded-lg bg-rose px-2.5 py-1.5 text-[10.5px] font-semibold text-rose-ink">
                  {error}
                </p>
              ) : null}
              <button type="submit" disabled={busy} className="neo-btn neo-btn-dark">
                {busy ? "Signing in…" : "Sign in"}
              </button>
            </form>
          </div>

          <div className="neo-card mt-3 p-4">
            <div className="neo-eyebrow">Demo accounts · password venloop-demo-123</div>
            <button
              type="button"
              onClick={() => {
                setEmail("caregiver.a@venloop.demo");
                setPassword("venloop-demo-123");
              }}
              className="mt-1 text-[9.5px] font-semibold underline"
            >
              Use caregiver A
            </button>
            <ul className="mt-2 flex flex-col gap-1.5">
              {DEMO_ACCOUNTS.map((account) => (
                <li key={account.email} className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full border border-ink ${account.tone}`} />
                  <button
                    type="button"
                    onClick={() => {
                      setEmail(account.email);
                      setPassword("venloop-demo-123");
                    }}
                    className="text-left text-[10px] hover:underline"
                  >
                    <span className="font-semibold">{account.email}</span>
                    <span className="text-ink-muted"> · {account.role}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
    </main>
  );
}
