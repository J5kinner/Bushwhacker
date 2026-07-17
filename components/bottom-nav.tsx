"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShoppingCart, CalendarDays, ListChecks, Settings } from "lucide-react";

const TABS = [
  { href: "/shopping", label: "Shopping", Icon: ShoppingCart },
  { href: "/calendar", label: "Calendar", Icon: CalendarDays },
  { href: "/chores", label: "Chores", Icon: ListChecks },
  { href: "/settings", label: "Settings", Icon: Settings },
] as const;

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 border-t border-black/10 bg-background/95 backdrop-blur dark:border-white/10"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <ul className="mx-auto flex w-full max-w-md items-stretch">
        {TABS.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`flex flex-col items-center gap-1 py-2 text-xs transition-colors ${
                  active ? "text-foreground" : "text-zinc-500 dark:text-zinc-400"
                }`}
              >
                <Icon
                  className="size-6"
                  strokeWidth={active ? 2.4 : 1.8}
                  aria-hidden
                />
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
