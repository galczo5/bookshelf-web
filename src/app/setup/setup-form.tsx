"use client";

import { useActionState, useState } from "react";
import { setupAction, type SetupFormState } from "@/app/actions/setup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2 } from "lucide-react";

const REDIRECT_URI = "http://localhost:3000/api/auth/callback/google";

const initial: SetupFormState = { ok: false };

export function SetupForm() {
  const [state, action, pending] = useActionState(setupAction, initial);
  const [applying, setApplying] = useState(false);

  if (applying) {
    return <ApplyingScreen />;
  }

  if (state.ok) {
    // Trigger the applying screen and start polling
    setApplying(true);
    return null;
  }

  return (
    <form action={action} className="flex flex-col gap-6">
      <section className="rounded-lg border bg-muted/40 p-4 text-sm">
        <p className="font-medium mb-2">Before you start</p>
        <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
          <li>
            Go to{" "}
            <span className="font-mono text-foreground">
              Google Cloud Console → APIs & Services → Credentials
            </span>
          </li>
          <li>Create an OAuth 2.0 Client ID (Web application)</li>
          <li>
            Add this Authorized redirect URI:
            <br />
            <span className="font-mono text-foreground select-all bg-background border rounded px-2 py-0.5 inline-block mt-1">
              {REDIRECT_URI}
            </span>
          </li>
          <li>Copy the Client ID and Client Secret below</li>
        </ol>
      </section>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-sm font-semibold mb-2">Google OAuth</legend>
        <Field
          name="GOOGLE_CLIENT_ID"
          label="Client ID"
          required
          error={state.errors?.GOOGLE_CLIENT_ID}
        />
        <Field
          name="GOOGLE_CLIENT_SECRET"
          label="Client Secret"
          type="password"
          required
          error={state.errors?.GOOGLE_CLIENT_SECRET}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-sm font-semibold mb-2">OpenAI</legend>
        <Field
          name="OPENAI_API_KEY"
          label="API Key"
          type="password"
          required
          error={state.errors?.OPENAI_API_KEY}
        />
        <Field
          name="OPENAI_MODEL"
          label="Model (optional)"
          placeholder="gpt-4.1-mini"
          error={state.errors?.OPENAI_MODEL}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-sm font-semibold mb-2">Owner</legend>
        <Field
          name="BOOKSHELF_ALLOWED_EMAIL"
          label="Owner email"
          type="email"
          required
          placeholder="you@example.com"
          error={state.errors?.BOOKSHELF_ALLOWED_EMAIL}
        />
      </fieldset>

      <div className="flex items-center gap-3">
        <Checkbox id="demo" name="demo" />
        <Label htmlFor="demo" className="cursor-pointer">
          Load 50-book demo dataset (public-domain books — no Drive required)
        </Label>
      </div>

      <Button type="submit" disabled={pending} className="self-start">
        {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
        Save &amp; apply
      </Button>
    </form>
  );
}

function Field({
  name,
  label,
  type = "text",
  required,
  placeholder,
  error,
}: {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  placeholder?: string;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={name}>
        {label}
        {required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      <Input
        id={name}
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        aria-describedby={error ? `${name}-error` : undefined}
        className={error ? "border-destructive" : undefined}
      />
      {error && (
        <p id={`${name}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function ApplyingScreen() {
  // Poll /api/health until the restarted server responds, then navigate.
  // Use an effect to avoid SSR issues with window/setTimeout.
  if (typeof window !== "undefined") {
    pollThenNavigate();
  }
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <Loader2 className="size-8 animate-spin text-muted-foreground" />
      <p className="text-lg font-medium">Applying settings…</p>
      <p className="text-sm text-muted-foreground">
        The app is restarting with your configuration. This takes a few seconds.
      </p>
    </div>
  );
}

let polling = false;

async function pollThenNavigate() {
  if (polling) return;
  polling = true;

  // Give the restart a moment to begin before we start polling
  await delay(2000);

  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (res.ok) {
        window.location.href = "/signin";
        return;
      }
    } catch {
      // server restarting — keep polling
    }
    await delay(500);
  }

  // Timeout: let the user refresh manually
  polling = false;
  alert("The app is taking longer than expected to restart. Please refresh the page.");
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
