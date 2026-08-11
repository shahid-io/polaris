import { cn } from '@/lib/utils';

/** Loading placeholder shaped like the content it stands in for. */
function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}

export { Skeleton };
