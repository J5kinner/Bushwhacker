import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Reuse a tab's client-side render for 30s so switching back is instant.
    // Server Actions' revalidatePath still purges this cache after mutations.
    staleTimes: { dynamic: 30 },
  },
};

export default nextConfig;
