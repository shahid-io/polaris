import type { SearchMeta } from '@polaris/contracts';

import { Badge } from '@/components/ui/badge';

/**
 * Summarises what the search found.
 *
 * Leads with the offers-to-flights reduction because that number is the product's whole
 * argument: 62 offers becoming 37 flights is the deduplication doing visible work, and
 * "8 sold by more than one provider" is where the comparison value actually lives.
 */
export function ResultsHeader({ meta, shown }: { meta: SearchMeta; shown: number }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 className="text-lg font-semibold">
        {meta.totalOffers} offers · {meta.totalGroups} flights
      </h2>
      {meta.multiProviderGroups > 0 && (
        <span className="text-sm text-muted-foreground">
          {meta.multiProviderGroups} sold by more than one provider
        </span>
      )}
      {shown !== meta.totalGroups && (
        <Badge variant="outline">
          {shown} shown after filters
        </Badge>
      )}
      {meta.cached && <Badge variant="outline">cached</Badge>}
      <span className="tabular ml-auto text-xs text-muted-foreground">{meta.tookMs}ms</span>
    </div>
  );
}
