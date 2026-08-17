import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import { BottomNav } from "@/components/bottom-nav";
import { LiveRefresh } from "@/components/live-refresh";
import { SwRegister } from "@/components/sw-register";
import { auth } from "@/auth";

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

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
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
          </div>
        ) : (
          // Unauthenticated (e.g. the sign-in page): no nav chrome.
          <div className="mx-auto min-h-dvh w-full max-w-md">{children}</div>
        )}
        <SwRegister />
        {/*
          Outside the session branch on purpose: the sign-in page's load
          performance counts too. Renders null and injects a deferred script,
          and sends nothing in development.
        */}
        <SpeedInsights />
      </body>
    </html>
  );
}
