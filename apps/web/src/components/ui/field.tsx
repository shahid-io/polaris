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

function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return <input className={cn(controlClassName, className)} {...props} />;
}

function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return <select className={cn(controlClassName, 'cursor-pointer', className)} {...props} />;
}

export { Field, Input, Select, controlClassName };
