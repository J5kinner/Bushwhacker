import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { SwRegister } from "@/components/sw-register";
import { WebVitalsReporter } from "@/components/web-vitals-reporter";
import { THEME_COOKIE } from "@/lib/theme";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
/*
  `preload: false` because exactly one element in the app is monospaced — the
  location token and endpoint in Settings. Preloading put a 23KB face in the
  HTTP Link header of every page, competing with genuinely critical resources
  at first paint on five tabs that never render a monospace glyph. Without the
  preload the @font-face rule still ships, and the browser fetches the file
  only on a page that actually applies it.
*/
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  preload: false,
});

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
 * Applies the saved theme before the browser paints.
 *
 * Runs synchronously in <head>, ahead of any markup, so the first frame is
 * already the right colour — the flash this avoids is why it is a blocking
 * inline script rather than an effect. It reads the cookie rather than asking
 * the server because the alternative is a per-request read in this layout, and
 * anything awaited here makes every route in the app dynamic.
 *
 * Wrapped in try/catch because a browser with cookies disabled throws on
 * `document.cookie`, and a theme preference is not worth a blank page.
 */
const applyTheme = `try{if(document.cookie.indexOf("${THEME_COOKIE}=dark")>-1)document.documentElement.classList.add("dark")}catch(e){}`;

/**
 * The document shell, and nothing else.
 *
 * Deliberately synchronous and free of any request-time read. This layout wraps
 * every route, so anything awaited here — a session, cookies, a theme lookup —
 * blocks all of them from being prerendered, and no amount of page-level work
 * can recover a static shell once the layout above it is dynamic. The nav
 * chrome that used to live here behind a session check now lives in the `(app)`
 * route group's layout, with the sign-in page sitting outside that group.
 */
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: applyTheme }} />
      </head>
      <body className="bg-background text-foreground">
        {children}
        <SwRegister />
        {/*
          All three outside any session branch so the sign-in page is measured
          too. Page views only: on Hobby, custom events are a Pro feature and
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
