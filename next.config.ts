import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
    Lets each route ship a prerendered shell — its layout and loading.tsx —
    from the CDN, with the request-time part streaming in behind a Suspense
    boundary. Without it every page here was force-dynamic, which meant Link
    prefetching had nothing to fetch: the default prefetch is partial, and a
    force-dynamic route has no partial to serve. Tapping a tab therefore always
    waited on a function invocation.

    The trade this imposes: `export const dynamic` is rejected outright, and any
    request-time read outside a Suspense boundary fails the build rather than
    silently making a route dynamic.
  */
  cacheComponents: true,
};

export default nextConfig;
