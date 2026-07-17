// Next.js 16 renamed middleware.ts -> proxy.ts. Auth.js protects every matched
// route and redirects unauthenticated requests to the sign-in page.
export { auth as proxy } from "@/auth";

export const config = {
  // Protect app routes; skip API, Next internals, the sign-in page, and any
  // file with an extension (manifest, service worker, icons, etc.).
  matcher: ["/((?!api|_next|signin|.*\\.).*)"],
};
