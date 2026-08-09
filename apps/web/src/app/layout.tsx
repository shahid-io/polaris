import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Polaris — Flight Comparison',
  description: 'Find your bearing on every fare. Compare flights across multiple providers.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 text-slate-900 antialiased">{children}</body>
    </html>
  );
}
