import { signIn } from "@/auth";
import { Button } from "@/components/ui/button";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">HomeSync</h1>
        <p className="mt-1 text-sm text-zinc-500">Sign in to your household.</p>
      </div>

      {error && (
        <p className="text-sm text-red-600 dark:text-red-400">
          {error === "AccessDenied"
            ? "That account isn't on the household allowlist."
            : "Sign-in failed. Please try again."}
        </p>
      )}

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
