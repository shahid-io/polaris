import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border text-muted-foreground',
        /** Real market data from a contracted API. */
        live: 'border-success/40 bg-success/10 text-success',
        /**
         * Real market data read from the provider's own web search.
         *
         * Distinct from `live` on purpose: the fare is genuine and current, but it comes
         * through an undocumented endpoint rather than an agreed contract, and a reader
         * deserves to see that difference rather than have it averaged away.
         */
        sourced: 'border-primary/40 bg-primary/10 text-primary',
        /** Generated data, never presented as real. */
        simulated: 'border-warning/40 bg-warning/10 text-warning',
        destructive: 'border-destructive/40 bg-destructive/10 text-destructive',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant, className }))} {...props} />
  );
}

export type BadgeProps = React.ComponentProps<typeof Badge>;
export { Badge, badgeVariants };
