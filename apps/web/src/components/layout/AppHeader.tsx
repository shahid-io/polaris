import { StarIcon } from 'lucide-react';

import { ThemeToggle } from '@/components/layout/ThemeToggle';

/**
 * Application header.
 *
 * Sticky, because the theme control and the product identity should stay reachable while
 * scrolling a long result list. Kept to a single row — a comparison tool earns its screen
 * space with results, not chrome.
 *
 * The mark is a star: Polaris is the North Star, and the name only means something with it.
 * Filled rather than outlined because an outline at 16px reads as noise, and sat in a
 * rounded tile so its optical centre is fixed — a bare glyph has to be nudged by hand to
 * sit level with text beside it, and that nudge breaks at other sizes.
 */
export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span
            className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary"
            aria-hidden="true"
          >
            <StarIcon className="size-4 fill-primary-foreground text-primary-foreground" />
          </span>

          <span className="flex items-baseline gap-2">
            <span className="text-base leading-none font-semibold tracking-tight">Polaris</span>
            <span className="hidden text-sm leading-none text-muted-foreground sm:inline">
              flight comparison
            </span>
          </span>
        </div>

        <ThemeToggle />
      </div>
    </header>
  );
}
