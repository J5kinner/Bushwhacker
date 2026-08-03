/** Instant skeleton shown while the shopping list streams in. */
export default function ShoppingLoading() {
  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Shopping</h1>
      <div className="animate-pulse space-y-3" aria-hidden>
        <div className="h-10 rounded-lg bg-zinc-200 dark:bg-zinc-800" />
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-12 rounded-lg bg-zinc-100 dark:bg-zinc-900"
          />
        ))}
      </div>
    </div>
  );
}
