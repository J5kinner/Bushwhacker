import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import { CheckCircle2, XCircle } from "lucide-react";
import { getDb, isDbConfigured } from "@/db";
import { users } from "@/db/schema";
import { getShoppingCategories } from "@/lib/queries";
import { getSetupIssue, getCurrentUserId } from "@/lib/household";
import { auth, signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import { SetupNotice } from "@/components/db-notice";
import { CategoryManager } from "./category-manager";
import { LocationSetup } from "./location-setup";
import { NotificationsSettings } from "./notifications";
import { ThemeToggle } from "./theme-toggle";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [session, categories, setupIssue, userId, headerList] = await Promise.all([
    auth(),
    getShoppingCategories(),
    getSetupIssue(),
    getCurrentUserId(),
    headers(),
  ]);

  // Read the deployment's own host so the endpoint shown is the one this phone
  // is actually talking to — localhost in development, the preview URL on a
  // preview, production in production. Hard-coding it would hand someone the
  // wrong URL on two of those three.
  const host = headerList.get("host") ?? "localhost:3000";
  const protocol = host.startsWith("localhost") ? "http" : "https";
  const endpoint = `${protocol}://${host}/api/location`;

  let locationToken: string | null = null;
  let darkMode = false;
  if (userId && isDbConfigured()) {
    const [member] = await getDb()
      .select({ token: users.locationToken, darkMode: users.darkMode })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    locationToken = member?.token ?? null;
    darkMode = member?.darkMode ?? false;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      {setupIssue && <SetupNotice issue={setupIssue} />}

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Account
        </h2>
        {session?.user ? (
          /*
            The email wraps rather than truncating. The margin here was thinner
            than it looked: the column is 204px at 320px, and the signed-in
            address fits with about two characters to spare, so a slightly
            longer one loses its tail — and the tail is the domain, which is the
            part that tells you which of the two household accounts you are in.
            `wrap-break-word` is what does the work, an address being a single
            unbroken token that ordinary wrapping will not break.
          */
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="wrap-break-word text-base">
                {session.user.name ?? "Signed in"}
              </p>
              <p className="wrap-break-word text-sm text-zinc-500">
                {session.user.email}
              </p>
            </div>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/signin" });
              }}
            >
              <Button type="submit" variant="outline" size="sm">
                Sign out
              </Button>
            </form>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">Not signed in.</p>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Appearance
        </h2>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm">Dark mode</p>
          <ThemeToggle initialDarkMode={darkMode} />
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Status
        </h2>
        <div className="flex items-center gap-2 text-sm">
          {setupIssue === null ? (
            <CheckCircle2 className="size-4 text-emerald-500" aria-hidden />
          ) : (
            <XCircle className="size-4 text-amber-500" aria-hidden />
          )}
          {/* The notice above carries the detail; this line is the summary. */}
          <span>
            Household {setupIssue === null ? "ready" : "setup incomplete"}
          </span>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Shopping categories
        </h2>
        <CategoryManager
          initialCategories={categories.map((c) => ({ id: c.id, name: c.name }))}
        />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Location sharing
        </h2>
        <LocationSetup initialToken={locationToken} endpoint={endpoint} />
      </section>

      <section>
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">
          Notifications
        </h2>
        <NotificationsSettings />
      </section>

      <section className="space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
          About
        </h2>
        <p>
          HomeSync is for a two-person household — two accounts, one shared
          shopping list, calendar, and map.
        </p>
        <p>
          Location sharing is off until you turn it on, and only ever stores
          your latest position — never a history of where you have been.
        </p>
      </section>
    </div>
  );
}
