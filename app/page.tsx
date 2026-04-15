export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col items-start justify-center px-6 py-24">
      <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-background-elevated px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
        LeadFlow · v0.1
      </span>

      <h1 className="font-serif text-display text-balance">
        Verified YouTube creator leads,{" "}
        <span className="italic text-accent">delivered daily.</span>
      </h1>

      <p className="mt-6 max-w-2xl text-lg text-foreground-muted">
        Define your ideal customer profile once. LeadFlow searches YouTube,
        verifies the creator is monetizing, finds their email and Instagram,
        and surfaces 10+ qualified leads in your dashboard every day.
      </p>

      <div className="mt-10 text-sm text-foreground-subtle">
        Setup in progress — auth, onboarding, and dashboard arrive in the next build step.
      </div>
    </main>
  );
}
