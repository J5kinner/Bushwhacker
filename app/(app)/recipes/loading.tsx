/** Instant skeleton shown while saved recipes stream in. */
export default function RecipesLoading() {
  return (
    <div>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight">Recipes</h1>
      <div className="animate-pulse space-y-3" aria-hidden>
        <div className="h-10 rounded-lg bg-zinc-200 dark:bg-zinc-800" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="h-16 rounded-lg bg-zinc-100 dark:bg-zinc-900"
          />
        ))}
      </div>
    </div>
  );
}
