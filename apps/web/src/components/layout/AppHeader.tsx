import { NavigationIcon } from 'lucide-react';

import { ThemeToggle } from '@/components/layout/ThemeToggle';

/**
 * Application header.
 *
 * Sticky, because the theme control and the product identity should stay reachable while
 * scrolling a long result list. Kept to a single row — a comparison tool earns its screen
 * space with results, not chrome.
 */
export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-2">
          <NavigationIcon
            className="size-5 -rotate-45 text-primary"
            aria-hidden="true"
          />
          <span className="text-base font-semibold tracking-tight">Polaris</span>
          <span className="hidden text-sm text-muted-foreground sm:inline">
            · flight comparison
          </span>
        </div>

        <ThemeToggle />
      </div>
    </header>
  );
}
