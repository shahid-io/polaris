'use client';

import { InfoIcon } from 'lucide-react';
import type { ValueScore } from '@polaris/contracts';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

const DIMENSIONS = [
  { key: 'price', label: 'Price' },
  { key: 'duration', label: 'Duration' },
  { key: 'stops', label: 'Stops' },
  { key: 'benefits', label: 'Benefits' },
] as const;

/**
 * Explains why a flight ranks where it does.
 *
 * The brief asks users to compare on "overall value", which is inherently a judgement. A
 * bare number invites the fair question "who decided that?" — so every sub-score, the
 * weight applied to it, and the fact that scores are relative to the full result set are
 * all shown. That turns a mysterious algorithm into visible product reasoning.
 */
export function ScoreBreakdown({ score }: { score: ValueScore }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          aria-label={`Value score ${score.total.toFixed(2)} of 1. How is this calculated?`}
        >
          <InfoIcon className="size-3" aria-hidden="true" />
          Value {score.total.toFixed(2)}
        </button>
      </PopoverTrigger>

      <PopoverContent className="w-72 p-3">
        <p className="text-sm font-medium">How this score is calculated</p>
        <p className="mt-1 text-xs text-muted-foreground">
          A weighted blend of four measures. Each is scored against the other flights in
          this search, so 1.00 means best in these results.
        </p>

        <ul className="mt-3 flex flex-col gap-2">
          {DIMENSIONS.map(({ key, label }) => (
            <li key={key} className="flex items-center gap-2 text-xs">
              <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
              <span
                className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"
                role="img"
                aria-label={`${label}: ${Math.round(score.breakdown[key] * 100)} out of 100`}
              >
                <span
                  className={cn('block h-full rounded-full bg-primary')}
                  style={{ width: `${Math.max(2, score.breakdown[key] * 100)}%` }}
                />
              </span>
              <span className="tabular w-8 shrink-0 text-right font-medium">
                {score.breakdown[key].toFixed(2)}
              </span>
              <span className="tabular w-9 shrink-0 text-right text-muted-foreground">
                {Math.round(score.weights[key] * 100)}%
              </span>
            </li>
          ))}
        </ul>

        <p className="mt-3 border-t border-border pt-2 text-[11px] text-muted-foreground">
          Scores compare against the full search result, not the filtered view — so
          filtering never changes a flight&apos;s score.
        </p>
      </PopoverContent>
    </Popover>
  );
}
