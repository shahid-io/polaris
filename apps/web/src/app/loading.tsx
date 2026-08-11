import { Skeleton } from '@/components/ui/skeleton';

/**
 * Route-level loading state.
 *
 * Shaped like the page it replaces, header, search form, results, so the layout does not
 * jump when content arrives. A centred spinner would be less work and a worse experience.
 */
export default function Loading() {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:py-12">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-5 w-80" />
      </div>
      <Skeleton className="h-40 w-full" />
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-40 w-full" />
        ))}
      </div>
    </div>
  );
}
