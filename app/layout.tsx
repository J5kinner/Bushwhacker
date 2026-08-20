import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { BottomNav } from "@/components/bottom-nav";
import { LiveRefresh } from "@/components/live-refresh";
import { PushResubscribe } from "@/components/push-resubscribe";
import { SwRegister } from "@/components/sw-register";
import { WebVitalsReporter } from "@/components/web-vitals-reporter";
import { auth } from "@/auth";
import { getCurrentUserDarkMode } from "@/lib/queries";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "HomeSync",
  description: "Shared shopping, calendar, and chores for a two-person household.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "HomeSync" },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await auth();
  const darkMode = await getCurrentUserDarkMode(session);

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased${darkMode ? " dark" : ""}`}
    >
      <body className="bg-background text-foreground">
        {session ? (
          // Authenticated: full app shell with the bottom tab bar.
          <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col">
            {/*
              The bottom padding reserves exactly the band the fixed nav covers —
              its 4rem height plus the home-indicator inset underneath it — so
              page content can always scroll clear of the nav. A flat value would
              come up short by the inset on an iPhone.
            */}
            <main className="flex-1 px-4 pb-[calc(4rem+env(safe-area-inset-bottom))] pt-6">
              {children}
            </main>
            <BottomNav />
            <LiveRefresh />
            <PushResubscribe />
          </div>
        ) : (
          // Unauthenticated (e.g. the sign-in page): no nav chrome.
          <div className="mx-auto min-h-dvh w-full max-w-md">{children}</div>
        )}
        <SwRegister />
        {/*
          Both outside the session branch so the sign-in page is measured too.
          Page views only: on Hobby, custom events are a Pro feature and
          track() silently discards, so this app makes no track() calls at all.
          See ADR 0005.
        */}
        <SpeedInsights />
        <Analytics />
        <WebVitalsReporter />
      </body>
    </html>
  );
}
