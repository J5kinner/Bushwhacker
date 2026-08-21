import { Suspense } from "react";
import { signIn } from "@/auth";
import { Button } from "@/components/ui/button";

/**
 * Why the failure reason is its own component: reading `searchParams` is a
 * request-time read, and doing it in the page body would hold back the whole
 * page — heading, button and all — until the request arrived. Behind a Suspense
 * boundary the rest of the page prerenders and this one line streams in, which
 * matters because the common case has no error to show at all.
 */
async function ErrorNote({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  if (!error) return null;

  return (
    <p className="text-sm text-red-600 dark:text-red-400">
      {error === "AccessDenied"
        ? "That account isn't on the household allowlist."
        : "Sign-in failed. Please try again."}
    </p>
  );
}

export default function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  return (
    // The width clamp is this page's own: the root layout is the bare document
    // shell, and the nav-bearing shell that clamps the tabs is the `(app)`
    // group's layout, which the sign-in page sits outside of.
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col items-center justify-center gap-6 px-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">HomeSync</h1>
        <p className="mt-1 text-sm text-zinc-500">Sign in to your household.</p>
      </div>

      <Suspense fallback={null}>
        <ErrorNote searchParams={searchParams} />
      </Suspense>

      <form
        action={async () => {
          "use server";
          await signIn("google", { redirectTo: "/shopping" });
        }}
      >
        <Button type="submit" size="lg">
          Continue with Google
        </Button>
      </form>
    </div>
  );
}
