/**
 * Placeholder /dashboard route so the onboarding redirect has a valid target.
 * The real lead-feed UI is built in a later step.
 */
export default function DashboardPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col items-start justify-center px-6 py-24">
      <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-background-elevated px-3 py-1 text-xs uppercase tracking-[0.18em] text-foreground-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-accent" />
        Dashboard
      </span>

      <h1 className="font-serif text-display text-balance">
        Your leads are <span className="italic text-accent">on the way.</span>
      </h1>

      <p className="mt-6 max-w-2xl text-lg text-foreground-muted">
        Your ICP is saved. The lead feed, pipeline trigger, and filters arrive in the next build step.
      </p>
    </main>
  );
}
