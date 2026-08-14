import { Badge } from '@/components/ui/badge';
import { provenanceOf } from '@/lib/provenance';

/**
 * Badges where an offer's price actually came from.
 *
 * Rendered beside the price on every surface that shows one, rather than once in a
 * footnote. The brief asks for representative data to be documented; showing it at the
 * number it qualifies is the difference between disclosing it and burying it.
 */
export function ProvenanceBadge({ integrationType }: { integrationType: string }) {
  const { variant, label, title } = provenanceOf(integrationType);

  return (
    <Badge variant={variant} title={title}>
      {label}
    </Badge>
  );
}
