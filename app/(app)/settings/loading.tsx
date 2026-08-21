/** Instant skeleton shown while settings (account, categories) stream in. */
export default function SettingsLoading() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      {["Account", "Appearance", "Status", "Shopping categories"].map((heading) => (
        <section key={heading}>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
            {heading}
          </h2>
          <div className="animate-pulse space-y-2" aria-hidden>
            <div className="h-5 w-3/4 rounded bg-zinc-200 dark:bg-zinc-800" />
            <div className="h-5 w-1/2 rounded bg-zinc-100 dark:bg-zinc-900" />
          </div>
        </section>
      ))}
    </div>
  );
}
