import type { BadgeProps } from '@/components/ui/badge';

/**
 * How a provenance value is presented next to a price.
 *
 * Extracted because three components badge the same field, and a provenance label that
 * disagrees between the list and the detail view is worse than no label: it makes the
 * whole disclosure look decorative. One function, one answer, everywhere.
 */
export interface ProvenancePresentation {
  variant: NonNullable<BadgeProps['variant']>;
  label: string;
  /** Hover text, so the badge can be short without being cryptic. */
  title: string;
}

/**
 * Maps an offer's integration type onto its badge.
 *
 * The default is deliberately the cautious one. A provenance value this build does not
 * recognise is not assumed to be real, because the failure modes are not symmetric:
 * labelling generated data "Live" misleads a user about a price, while labelling real data
 * "Representative" only undersells it.
 *
 * @param integrationType - The offer's declared provenance.
 * @returns Badge variant, label and hover text.
 */
export function provenanceOf(integrationType: string): ProvenancePresentation {
  switch (integrationType) {
    case 'live-api':
      return {
        variant: 'live',
        label: 'Live',
        title: 'Real market data from a live third-party API',
      };
    case 'browser-automation':
      return {
        variant: 'sourced',
        label: 'From provider site',
        title:
          "Real, current fare read from the provider's own public search page. Not a " +
          'contracted API, so the endpoint carries no stability guarantee.',
      };
    case 'sandbox-api':
      return {
        variant: 'simulated',
        label: 'Sandbox',
        title: 'Real API contract, synthetic vendor test data',
      };
    default:
      return {
        variant: 'simulated',
        label: 'Representative',
        title:
          'Generated data, not a real fare. Used where a provider is genuinely ' +
          'unobtainable, and never presented as real.',
      };
  }
}
