"use client";

import { useMemo, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function LoginPage() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<
    "idle" | "sending" | "sent" | "error"
  >("idle");
  const [message, setMessage] = useState<string>("");

  return (
    <div className="mx-auto max-w-md">
      <div className="glass rounded-2xl p-6">
        <div className="text-lg font-semibold">Sign in</div>
        <div className="mt-1 text-sm text-muted-foreground">
          Magic link login for PressPulse.
        </div>

        <form
          className="mt-5 space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setStatus("sending");
            setMessage("");

            const { error } = await supabase.auth.signInWithOtp({
              email,
              options: {
                emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`
              }
            });

            if (error) {
              setStatus("error");
              setMessage(error.message);
              return;
            }

            setStatus("sent");
            setMessage("Check your inbox for the magic link.");
          }}
        >
          <label className="block text-xs text-muted-foreground">Email</label>
          <input
            className="h-11 w-full rounded-xl bg-white/5 px-4 text-sm outline-none ring-1 ring-white/10 placeholder:text-muted-foreground focus:ring-2 focus:ring-white/20"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            required
          />
          <button
            type="submit"
            className="h-11 w-full rounded-xl bg-white/10 text-sm font-medium ring-1 ring-white/10 transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={status === "sending" || !email}
          >
            {status === "sending" ? "Sending…" : "Send magic link"}
          </button>
        </form>

        {message ? (
          <div className="mt-4 rounded-xl bg-white/5 px-4 py-3 text-sm ring-1 ring-white/10">
            {message}
          </div>
        ) : null}
      </div>
    </div>
  );
}

