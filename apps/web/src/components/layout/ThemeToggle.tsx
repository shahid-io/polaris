'use client';

import { useTheme } from 'next-themes';
import { MoonIcon, SunIcon } from 'lucide-react';
import { useSyncExternalStore } from 'react';

import { Button } from '@/components/ui/button';

/** Nothing to subscribe to, whether we are on the client never changes after hydration. */
const subscribe = () => () => {};

/**
 * True once hydrated, false while rendering on the server.
 *
 * The usual spelling of this is `useState(false)` plus an effect that immediately sets it
 * true, but that is a state update in an effect purely to learn something React already
 * knows, and it costs a second render on every mount. `useSyncExternalStore` takes a server
 * snapshot and a client snapshot as separate arguments, which is exactly the shape of the
 * question, no effect, and no lying to React about why the value changed.
 */
const useHasHydrated = () =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

/**
 * Switches between light and dark.
 *
 * The provider still starts from the operating system's preference, so a first-time
 * visitor gets the theme they already prefer without choosing. Pressing this makes the
 * choice explicit and it persists from then on. There is no separate "system" control,
 * because a two-state control that reads its initial value from the OS covers the case
 * without asking the user to think about a third one.
 *
 * Decided from `resolvedTheme` rather than `theme`: before a choice is made, `theme` is
 * the string `"system"`, which says nothing about whether the page is currently light or
 * dark and would put the wrong icon on the button.
 */
export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const hasHydrated = useHasHydrated();

  // The server cannot know a stored preference, so rendering the real icon during SSR
  // would produce markup the client disagrees with. The placeholder holds the same space
  // so the header does not shift when the button appears.
  if (!hasHydrated) {
    return <div className="size-9" aria-hidden="true" />;
  }

  const isDark = resolvedTheme === 'dark';

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {isDark ? <SunIcon aria-hidden="true" /> : <MoonIcon aria-hidden="true" />}
    </Button>
  );
}
