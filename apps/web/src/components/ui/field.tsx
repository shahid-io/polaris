import { ChevronsUpDownIcon } from 'lucide-react';
import * as React from 'react';

import { cn } from '@/lib/utils';

/** A labelled form control, so every field in the search form aligns identically. */
function Field({
  label,
  htmlFor,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label
        htmlFor={htmlFor}
        className="text-xs font-medium tracking-wide text-muted-foreground uppercase"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

const controlClassName =
  'h-[42px] w-full rounded-md border border-input bg-background px-3 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50';

/**
 * The date input's calendar button is drawn by the browser in a fixed dark colour, which
 * disappears against a dark background. Inverting it in dark mode is the only handle CSS
 * has on that control.
 */
const dateInputClassName =
  '[&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-60 dark:[&::-webkit-calendar-picker-indicator]:invert';

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(controlClassName, type === 'date' && dateInputClassName, className)}
      {...props}
    />
  );
}

/**
 * Native select with the platform chevron replaced.
 *
 * The browser's own arrow is drawn by the OS, so it ignores the page's colours and sits
 * where the platform puts it — noticeably heavier than the pickers beside it, and washed
 * out against a dark background. `appearance-none` removes it and the same
 * `ChevronsUpDownIcon` the airport pickers use is drawn in its place, so every control in
 * the search row reads as one family.
 *
 * Still a real `select`: keyboard behaviour, the native option list and mobile pickers all
 * keep working, which a div-based replacement would have to rebuild.
 */
function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return (
    <div className="relative">
      <select
        className={cn(controlClassName, 'cursor-pointer appearance-none pr-9', className)}
        {...props}
      />
      <ChevronsUpDownIcon
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 opacity-50"
        aria-hidden="true"
      />
    </div>
  );
}

export { Field, Input, Select, controlClassName };
