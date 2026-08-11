'use client';

import { ThemeProvider } from 'next-themes';
import type { ReactNode } from 'react';

/**
 * Composes every context provider.
 *
 * The root layout renders this one component rather than a stack of wrappers, so adding a
 * provider is a change in one place instead of an edit to the layout.
 */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider
      // The stylesheet defines its dark palette under `.dark`, so the class strategy is
      // what those tokens are already written against.
      attribute="class"
      defaultTheme="system"
      enableSystem
      // Transitions on a theme swap make every colour on the page animate at once, which
      // reads as a flash rather than a transition.
      disableTransitionOnChange
    >
      {children}
    </ThemeProvider>
  );
}
