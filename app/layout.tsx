import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";
import { SwRegister } from "@/components/sw-register";

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

/**
 * The document shell, and nothing else.
 *
 * Deliberately synchronous and free of any request-time read. This layout wraps
 * every route, so anything awaited here — a session, cookies, headers — blocks
 * all of them from being prerendered, and no amount of page-level work can
 * recover a static shell once the layout above it is dynamic. The nav chrome
 * that used to live here behind a session check now lives in the `(app)` route
 * group's layout, with the sign-in page sitting outside that group instead.
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="bg-background text-foreground">
        {children}
        <SwRegister />
        {/*
          Covers the sign-in page too — its load performance counts. Renders
          null and injects a deferred script, and sends nothing in development.
        */}
        <SpeedInsights />
      </body>
    </html>
  );
}
