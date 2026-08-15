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
 * recognise is not assumed to be current, because the failure modes are not symmetric:
 * presenting a stale price as live misleads a user about what they can buy, while
 * presenting a live price as replayed only undersells it.
 *
 * @param integrationType - The offer's declared provenance.
 * @returns Badge variant, label and hover text.
 */
export function provenanceOf(integrationType: string): ProvenancePresentation {
  switch (integrationType) {
    case 'browser-automation':
      return {
        variant: 'sourced',
        label: 'From provider site',
        title:
          "Real, current fare read from this seller's own public search. Follow the check " +
          'link to see it on their page.',
      };
    default:
      return {
        variant: 'simulated',
        label: 'Representative',
        title:
          'Replayed from a recording, so this price is real but not confirmed current. ' +
          'It is excluded from cheapest and best-value ranking.',
      };
  }
}
