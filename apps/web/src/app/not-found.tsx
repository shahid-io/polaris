import Link from 'next/link';
import { CompassIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';

/**
 * 404.
 *
 * Offers the one action that is always useful, get back to a working search, rather than
 * a dead end. The copy stays in the product's voice instead of reading like a server log.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <CompassIcon className="size-10 text-muted-foreground" aria-hidden="true" />
      <div>
        <p className="font-mono text-sm text-muted-foreground">404</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">Off course</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page does not exist. It may have moved, or the link may be wrong.
        </p>
      </div>
      <Button asChild>
        <Link href="/">Back to search</Link>
      </Button>
    </main>
  );
}
