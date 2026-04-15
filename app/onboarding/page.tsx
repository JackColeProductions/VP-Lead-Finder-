"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";

/* ---------------------------------------------------------------------------
 * Constants
 * ------------------------------------------------------------------------- */

const PRESET_NICHES = [
  "fitness",
  "tech",
  "beauty",
  "gaming",
  "cooking",
  "education",
  "finance",
  "lifestyle",
  "travel",
  "music",
  "comedy",
  "vlog",
] as const;

const PRESET_LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "pt", label: "Portuguese" },
  { code: "hi", label: "Hindi" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
];

// Logarithmic subscriber-range scale. Slider value is 0..1000; subscribers
// are mapped through powers of 10 so the lower end has finer granularity.
const SUBS_MIN = 1_000;
const SUBS_MAX = 5_000_000;
const LOG_MIN = Math.log10(SUBS_MIN);
const LOG_MAX = Math.log10(SUBS_MAX);
const LOG_SPAN = LOG_MAX - LOG_MIN;
const SLIDER_RES = 1000;
const SLIDER_GAP = 15; // min distance between the two handles, in slider units

function sliderToSubs(v: number): number {
  const exp = LOG_MIN + (v / SLIDER_RES) * LOG_SPAN;
  return Math.round(Math.pow(10, exp));
}

function subsToSlider(subs: number): number {
  const clamped = Math.max(SUBS_MIN, Math.min(SUBS_MAX, subs));
  return Math.round(((Math.log10(clamped) - LOG_MIN) / LOG_SPAN) * SLIDER_RES);
}

function formatSubs(n: number): string {
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return `${v >= 10 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (n >= 1_000) {
    const v = n / 1_000;
    return `${v >= 10 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")}K`;
  }
  return `${n}`;
}

/* ---------------------------------------------------------------------------
 * Wizard state
 * ------------------------------------------------------------------------- */

type WizardState = {
  niches: string[];
  customNicheInput: string;
  keywords: string;
  minSubscribers: number;
  maxSubscribers: number;
  minViewsAvg: number;
  mustHaveLinkInBio: boolean;
  mustHaveEmail: boolean;
  mustHaveInstagram: boolean;
  languages: string[];
  customLanguageInput: string;
};

const INITIAL_STATE: WizardState = {
  niches: [],
  customNicheInput: "",
  keywords: "",
  minSubscribers: 10_000,
  maxSubscribers: 250_000,
  minViewsAvg: 1_000,
  mustHaveLinkInBio: true,
  mustHaveEmail: true,
  mustHaveInstagram: false,
  languages: ["en"],
  customLanguageInput: "",
};

/* ---------------------------------------------------------------------------
 * Page
 * ------------------------------------------------------------------------- */

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [state, setState] = useState<WizardState>(INITIAL_STATE);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill from existing ICP if the user is re-running onboarding.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/icp");
        const data = await res.json();
        if (cancelled || !data?.icp) return;
        const icp = data.icp;
        setState((prev) => ({
          ...prev,
          niches: Array.isArray(icp.niches) ? icp.niches : prev.niches,
          keywords: Array.isArray(icp.keywords) ? icp.keywords.join(", ") : prev.keywords,
          minSubscribers: icp.min_subscribers ?? prev.minSubscribers,
          maxSubscribers: icp.max_subscribers ?? prev.maxSubscribers,
          minViewsAvg: icp.min_views_avg ?? prev.minViewsAvg,
          mustHaveLinkInBio: icp.must_have_link_in_bio ?? prev.mustHaveLinkInBio,
          mustHaveEmail: icp.must_have_email ?? prev.mustHaveEmail,
          mustHaveInstagram: icp.must_have_instagram ?? prev.mustHaveInstagram,
          languages: Array.isArray(icp.languages) ? icp.languages : prev.languages,
        }));
      } catch {
        // non-fatal: user just starts from defaults
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  function update<K extends keyof WizardState>(key: K, value: WizardState[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  function toggleNiche(niche: string) {
    setState((s) => ({
      ...s,
      niches: s.niches.includes(niche)
        ? s.niches.filter((n) => n !== niche)
        : [...s.niches, niche],
    }));
  }

  function addCustomNiche() {
    const n = state.customNicheInput.trim().toLowerCase();
    if (!n || state.niches.includes(n)) {
      setState((s) => ({ ...s, customNicheInput: "" }));
      return;
    }
    setState((s) => ({ ...s, niches: [...s.niches, n], customNicheInput: "" }));
  }

  function toggleLanguage(code: string) {
    setState((s) => ({
      ...s,
      languages: s.languages.includes(code)
        ? s.languages.filter((l) => l !== code)
        : [...s.languages, code],
    }));
  }

  function addCustomLanguage() {
    const l = state.customLanguageInput.trim().toLowerCase();
    if (!l || state.languages.includes(l)) {
      setState((s) => ({ ...s, customLanguageInput: "" }));
      return;
    }
    setState((s) => ({
      ...s,
      languages: [...s.languages, l],
      customLanguageInput: "",
    }));
  }

  function canAdvance(): boolean {
    if (step === 1) {
      return state.niches.length > 0 && state.keywords.trim().length > 0;
    }
    if (step === 2) {
      return (
        state.minSubscribers < state.maxSubscribers && state.minViewsAvg >= 0
      );
    }
    if (step === 3) {
      return state.languages.length > 0;
    }
    return true;
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      const keywords = state.keywords
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean);

      const res = await fetch("/api/icp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          niches: state.niches,
          keywords,
          min_subscribers: state.minSubscribers,
          max_subscribers: state.maxSubscribers,
          min_views_avg: state.minViewsAvg,
          languages: state.languages,
          must_have_link_in_bio: state.mustHaveLinkInBio,
          must_have_email: state.mustHaveEmail,
          must_have_instagram: state.mustHaveInstagram,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Failed to save your ICP.");
      }

      router.push("/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col px-6 py-14">
      {/* Brand mark */}
      <div className="mb-10 flex items-center gap-2.5">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
        <span className="text-xs uppercase tracking-[0.2em] text-foreground-muted">
          LeadFlow · Onboarding
        </span>
      </div>

      {/* Step indicator */}
      <StepIndicator current={step} total={4} />

      {/* Step content */}
      <div className="flex-1 pt-12">
        {loading ? (
          <div className="flex h-64 items-center justify-center text-sm text-foreground-muted">
            Loading your profile…
          </div>
        ) : (
          <div key={step} className="lf-animate-step">
            {step === 1 && (
              <StepNiches
                state={state}
                update={update}
                toggleNiche={toggleNiche}
                addCustomNiche={addCustomNiche}
              />
            )}
            {step === 2 && <StepSize state={state} update={update} />}
            {step === 3 && (
              <StepFilters
                state={state}
                update={update}
                toggleLanguage={toggleLanguage}
                addCustomLanguage={addCustomLanguage}
              />
            )}
            {step === 4 && <StepSummary state={state} />}
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="mt-12 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          disabled={step === 1 || submitting}
          className="text-sm text-foreground-muted transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
        >
          ← Back
        </button>

        {step < 4 ? (
          <button
            type="button"
            onClick={() => setStep((s) => s + 1)}
            disabled={!canAdvance()}
            className="rounded-full bg-accent px-6 py-2.5 text-sm font-medium text-background transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            Next →
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="rounded-full bg-accent px-7 py-2.5 text-sm font-medium text-background shadow-glow transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? "Saving…" : "Start Finding Leads →"}
          </button>
        )}
      </div>

      {error && (
        <div className="mt-6 rounded-lg border border-red-900/60 bg-red-950/30 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}
    </main>
  );
}

/* ---------------------------------------------------------------------------
 * Steps
 * ------------------------------------------------------------------------- */

type StepProps = {
  state: WizardState;
  update: <K extends keyof WizardState>(key: K, value: WizardState[K]) => void;
};

function StepNiches({
  state,
  update,
  toggleNiche,
  addCustomNiche,
}: StepProps & {
  toggleNiche: (n: string) => void;
  addCustomNiche: () => void;
}) {
  const customNiches = state.niches.filter(
    (n) => !(PRESET_NICHES as readonly string[]).includes(n),
  );

  return (
    <section>
      <h1 className="font-serif text-4xl leading-[1.1] text-balance sm:text-5xl">
        What kind of creators are you{" "}
        <span className="italic text-accent">looking for?</span>
      </h1>
      <p className="mt-4 max-w-xl text-foreground-muted">
        Pick the niches that match your ideal client. You can add custom ones below.
      </p>

      <div className="mt-10">
        <label className="text-[11px] uppercase tracking-[0.18em] text-foreground-subtle">
          Niches
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          {PRESET_NICHES.map((n) => (
            <Chip
              key={n}
              active={state.niches.includes(n)}
              onClick={() => toggleNiche(n)}
            >
              {n}
            </Chip>
          ))}
          {customNiches.map((n) => (
            <Chip key={n} active onClick={() => toggleNiche(n)}>
              {n} ×
            </Chip>
          ))}
        </div>

        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={state.customNicheInput}
            onChange={(e) => update("customNicheInput", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustomNiche();
              }
            }}
            placeholder="Add a custom niche…"
            className="flex-1 rounded-lg border border-border bg-background-elevated px-4 py-2 text-sm text-foreground placeholder:text-foreground-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ring"
          />
          <button
            type="button"
            onClick={addCustomNiche}
            disabled={!state.customNicheInput.trim()}
            className="rounded-lg border border-border px-4 py-2 text-sm text-foreground-muted transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </div>

      <div className="mt-10">
        <label
          htmlFor="icp-keywords"
          className="text-[11px] uppercase tracking-[0.18em] text-foreground-subtle"
        >
          Keywords
        </label>
        <textarea
          id="icp-keywords"
          value={state.keywords}
          onChange={(e) => update("keywords", e.target.value)}
          rows={3}
          placeholder="e.g. home gym review, calisthenics tutorial, protein shake recipes"
          className="mt-3 w-full resize-none rounded-lg border border-border bg-background-elevated px-4 py-3 text-sm text-foreground placeholder:text-foreground-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ring"
        />
        <p className="mt-2 text-xs text-foreground-subtle">
          Enter search terms you&apos;d use to find these creators on YouTube. Comma-separated.
        </p>
      </div>
    </section>
  );
}

function StepSize({ state, update }: StepProps) {
  const minSliderV = subsToSlider(state.minSubscribers);
  const maxSliderV = subsToSlider(state.maxSubscribers);
  const minPct = (minSliderV / SLIDER_RES) * 100;
  const maxPct = (maxSliderV / SLIDER_RES) * 100;

  return (
    <section>
      <h1 className="font-serif text-4xl leading-[1.1] text-balance sm:text-5xl">
        What <span className="italic text-accent">size channels?</span>
      </h1>
      <p className="mt-4 max-w-xl text-foreground-muted">
        Creators in this subscriber range will appear in your feed.
      </p>

      <div className="mt-12">
        <div className="flex items-baseline justify-between">
          <label className="text-[11px] uppercase tracking-[0.18em] text-foreground-subtle">
            Subscriber range
          </label>
          <div className="font-serif text-2xl text-accent">
            {formatSubs(state.minSubscribers)} — {formatSubs(state.maxSubscribers)}
          </div>
        </div>

        <div className="relative mt-6 h-6">
          <div className="absolute left-0 right-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-border" />
          <div
            className="absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-accent"
            style={{ left: `${minPct}%`, right: `${100 - maxPct}%` }}
          />
          <input
            type="range"
            min={0}
            max={SLIDER_RES}
            value={minSliderV}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v >= maxSliderV - SLIDER_GAP) return;
              update("minSubscribers", sliderToSubs(v));
            }}
            className="lf-range"
            style={{ zIndex: minSliderV > SLIDER_RES / 2 ? 3 : 2 }}
            aria-label="Minimum subscribers"
          />
          <input
            type="range"
            min={0}
            max={SLIDER_RES}
            value={maxSliderV}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v <= minSliderV + SLIDER_GAP) return;
              update("maxSubscribers", sliderToSubs(v));
            }}
            className="lf-range"
            style={{ zIndex: minSliderV > SLIDER_RES / 2 ? 2 : 3 }}
            aria-label="Maximum subscribers"
          />
        </div>

        <div className="mt-3 flex justify-between text-[11px] text-foreground-subtle">
          <span>1K</span>
          <span>10K</span>
          <span>100K</span>
          <span>1M</span>
          <span>5M</span>
        </div>
      </div>

      <div className="mt-12">
        <label
          htmlFor="min-views"
          className="text-[11px] uppercase tracking-[0.18em] text-foreground-subtle"
        >
          Minimum average views per video
        </label>
        <div className="relative mt-3">
          <input
            id="min-views"
            type="number"
            min={0}
            step={100}
            value={state.minViewsAvg}
            onChange={(e) =>
              update("minViewsAvg", Math.max(0, Number(e.target.value) || 0))
            }
            className="w-full rounded-lg border border-border bg-background-elevated px-4 py-3 pr-16 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ring"
          />
          <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-xs text-foreground-subtle">
            views
          </span>
        </div>
      </div>
    </section>
  );
}

function StepFilters({
  state,
  update,
  toggleLanguage,
  addCustomLanguage,
}: StepProps & {
  toggleLanguage: (code: string) => void;
  addCustomLanguage: () => void;
}) {
  const customLangs = state.languages.filter(
    (c) => !PRESET_LANGUAGES.some((l) => l.code === c),
  );

  return (
    <section>
      <h1 className="font-serif text-4xl leading-[1.1] text-balance sm:text-5xl">
        What <span className="italic text-accent">info matters most?</span>
      </h1>
      <p className="mt-4 max-w-xl text-foreground-muted">
        Only creators meeting these criteria will enter your feed.
      </p>

      <div className="mt-10 space-y-3">
        <ToggleRow
          label="Must have link in bio"
          description="Skip creators with no links in their YouTube description."
          checked={state.mustHaveLinkInBio}
          onChange={(v) => update("mustHaveLinkInBio", v)}
        />
        <ToggleRow
          label="Must have email"
          description="Only surface creators whose email we can extract."
          checked={state.mustHaveEmail}
          onChange={(v) => update("mustHaveEmail", v)}
        />
        <ToggleRow
          label="Must have Instagram"
          description="Require an Instagram handle for multi-channel outreach."
          checked={state.mustHaveInstagram}
          onChange={(v) => update("mustHaveInstagram", v)}
        />
      </div>

      <div className="mt-12">
        <label className="text-[11px] uppercase tracking-[0.18em] text-foreground-subtle">
          Content languages
        </label>
        <div className="mt-3 flex flex-wrap gap-2">
          {PRESET_LANGUAGES.map((lang) => (
            <Chip
              key={lang.code}
              active={state.languages.includes(lang.code)}
              onClick={() => toggleLanguage(lang.code)}
            >
              {lang.label}
            </Chip>
          ))}
          {customLangs.map((c) => (
            <Chip key={c} active onClick={() => toggleLanguage(c)}>
              {c.toUpperCase()} ×
            </Chip>
          ))}
        </div>

        <div className="mt-3 flex gap-2">
          <input
            type="text"
            value={state.customLanguageInput}
            onChange={(e) => update("customLanguageInput", e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustomLanguage();
              }
            }}
            placeholder="Add language code (e.g. it, zh)"
            className="flex-1 rounded-lg border border-border bg-background-elevated px-4 py-2 text-sm text-foreground placeholder:text-foreground-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ring"
          />
          <button
            type="button"
            onClick={addCustomLanguage}
            disabled={!state.customLanguageInput.trim()}
            className="rounded-lg border border-border px-4 py-2 text-sm text-foreground-muted transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            Add
          </button>
        </div>
      </div>
    </section>
  );
}

function StepSummary({ state }: { state: WizardState }) {
  const keywords = state.keywords
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  const requiredFields = [
    state.mustHaveLinkInBio && "Link in bio",
    state.mustHaveEmail && "Email",
    state.mustHaveInstagram && "Instagram",
  ].filter(Boolean) as string[];

  return (
    <section>
      <h1 className="font-serif text-4xl leading-[1.1] text-balance sm:text-5xl">
        You&apos;re <span className="italic text-accent">all set.</span>
      </h1>
      <p className="mt-4 max-w-xl text-foreground-muted">
        Here&apos;s a quick recap. Looks right? Let&apos;s start finding leads.
      </p>

      <div className="mt-10 overflow-hidden rounded-2xl border border-border bg-background-elevated">
        <SummaryRow label="Niches">
          <div className="flex flex-wrap justify-end gap-1.5">
            {state.niches.map((n) => (
              <span
                key={n}
                className="rounded-full border border-accent/30 bg-accent/10 px-2.5 py-0.5 text-xs capitalize text-accent"
              >
                {n}
              </span>
            ))}
          </div>
        </SummaryRow>
        <SummaryRow label="Keywords">
          <span className="text-sm text-foreground">
            {keywords.length > 0 ? (
              keywords.join(", ")
            ) : (
              <span className="text-foreground-subtle">None</span>
            )}
          </span>
        </SummaryRow>
        <SummaryRow label="Subscriber range">
          <span className="font-serif text-xl text-accent">
            {formatSubs(state.minSubscribers)} — {formatSubs(state.maxSubscribers)}
          </span>
        </SummaryRow>
        <SummaryRow label="Min avg views">
          <span className="text-sm text-foreground">
            {state.minViewsAvg.toLocaleString()}
          </span>
        </SummaryRow>
        <SummaryRow label="Required fields">
          <div className="flex flex-wrap justify-end gap-1.5">
            {requiredFields.length > 0 ? (
              requiredFields.map((f) => <Tag key={f}>{f}</Tag>)
            ) : (
              <span className="text-sm text-foreground-subtle">None</span>
            )}
          </div>
        </SummaryRow>
        <SummaryRow label="Languages" last>
          <div className="flex flex-wrap justify-end gap-1.5">
            {state.languages.map((l) => {
              const label =
                PRESET_LANGUAGES.find((x) => x.code === l)?.label ??
                l.toUpperCase();
              return <Tag key={l}>{label}</Tag>;
            })}
          </div>
        </SummaryRow>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------
 * UI primitives
 * ------------------------------------------------------------------------- */

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center">
      {Array.from({ length: total }, (_, i) => i + 1).map((n) => {
        const stateClass =
          n < current
            ? "border-accent/40 bg-accent/5 text-accent/80"
            : n === current
              ? "border-accent bg-accent/15 text-accent"
              : "border-border bg-background-elevated text-foreground-subtle";
        return (
          <div key={n} className="flex items-center">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full border text-xs font-medium transition-colors ${stateClass}`}
            >
              {n}
            </div>
            {n < total && (
              <div
                className={`h-px w-10 transition-colors ${n < current ? "bg-accent/40" : "bg-border"}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "rounded-full border px-4 py-1.5 text-sm capitalize transition-all " +
        (active
          ? "border-accent bg-accent/15 text-accent shadow-[0_0_0_1px_rgba(245,166,35,0.35)]"
          : "border-border bg-background-elevated text-foreground-muted hover:border-foreground-subtle hover:text-foreground")
      }
    >
      {children}
    </button>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div
      role="switch"
      aria-checked={checked}
      tabIndex={0}
      onClick={() => onChange(!checked)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onChange(!checked);
        }
      }}
      className="flex cursor-pointer items-center justify-between gap-6 rounded-xl border border-border bg-background-elevated px-5 py-4 transition-colors hover:border-foreground-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ring"
    >
      <div>
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className="mt-0.5 text-xs text-foreground-muted">{description}</div>
      </div>
      <div
        className={
          "relative h-6 w-11 shrink-0 rounded-full border transition-colors " +
          (checked
            ? "border-accent bg-accent/30"
            : "border-border bg-background-subtle")
        }
      >
        <span
          className={
            "absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full transition-all " +
            (checked
              ? "left-[22px] bg-accent shadow-[0_0_12px_rgba(245,166,35,0.6)]"
              : "left-[3px] bg-foreground-muted")
          }
        />
      </div>
    </div>
  );
}

function SummaryRow({
  label,
  children,
  last,
}: {
  label: string;
  children: ReactNode;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-start justify-between gap-6 px-5 py-4 ${last ? "" : "border-b border-border"}`}
    >
      <span className="pt-0.5 text-[11px] uppercase tracking-[0.18em] text-foreground-subtle">
        {label}
      </span>
      <div className="max-w-[65%] text-right">{children}</div>
    </div>
  );
}

function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full border border-border bg-background-subtle px-2.5 py-0.5 text-xs text-foreground-muted">
      {children}
    </span>
  );
}
