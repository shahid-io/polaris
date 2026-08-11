import type { SearchMeta } from '@polaris/contracts';

import { Badge } from '@/components/ui/badge';

/**
 * Summarises what the search found.
 *
 * Leads with the offers-to-flights reduction because that number is the product's whole
 * argument: 62 offers becoming 37 flights is deduplication doing visible work, and the
 * multi-provider count is where the comparison value actually lives.
 */
export function ResultsHeader({ meta, shown }: { meta: SearchMeta; shown: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border pb-3">
      <p className="flex items-baseline gap-1.5 text-lg font-semibold">
        <span className="tabular">{meta.totalOffers}</span>
        <span className="text-sm font-normal text-muted-foreground">offers from</span>
        <span className="tabular">{meta.providersSucceeded}</span>
        <span className="text-sm font-normal text-muted-foreground">providers →</span>
        <span className="tabular">{meta.totalGroups}</span>
        <span className="text-sm font-normal text-muted-foreground">flights</span>
      </p>

      {meta.multiProviderGroups > 0 && (
        <Badge variant="live">{meta.multiProviderGroups} sold by more than one provider</Badge>
      )}

      {shown !== meta.totalGroups && <Badge variant="outline">{shown} after filters</Badge>}
      {meta.cached && <Badge variant="outline">cached</Badge>}

      <span className="tabular ml-auto text-xs text-muted-foreground">{meta.tookMs} ms</span>
    </div>
  );
}
