import type { Metadata } from 'next';

import { AppHeader } from '@/components/layout/AppHeader';
import { Providers } from '@/components/providers/Providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Polaris — Flight Comparison',
  description:
    'Compare the same marketed flight across every provider that sells it, with each seller’s price side by side.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // next-themes sets the class on <html> before paint, which the server cannot predict.
    // suppressHydrationWarning silences the expected mismatch on this element only.
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <Providers>
          <AppHeader />
          {children}
        </Providers>
      </body>
    </html>
  );
}
