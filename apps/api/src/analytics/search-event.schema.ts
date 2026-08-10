import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/** What one provider contributed to a recorded search. */
@Schema({ _id: false })
export class ProviderOutcomeRecord {
  @Prop({ required: true })
  providerId!: string;

  @Prop({ required: true })
  status!: string;

  @Prop({ required: true })
  latencyMs!: number;

  @Prop({ required: true })
  offerCount!: number;

  /** Non-zero means an adapter's mapping is producing invalid offers. Worth alerting on. */
  @Prop({ default: 0 })
  droppedOfferCount!: number;
}

const ProviderOutcomeSchema = SchemaFactory.createForClass(ProviderOutcomeRecord);

/**
 * One recorded search.
 *
 * ### What is deliberately absent
 * No IP address, no cookie, no session id, no user agent — nothing that identifies a
 * person. Storing IP alongside a search query would make this personal data under India's
 * **DPDP Act 2023** and the GDPR, bringing obligations a prototype has no business
 * incurring: a lawful basis, a retention policy, subject-access handling.
 *
 * Everything genuinely useful here is operational rather than personal. "Which providers
 * are slow", "how often does the cache hit", "does deduplication actually fire on real
 * traffic" are all answerable from this shape without knowing who searched. If per-request
 * diagnostics ever became necessary, the design would be: truncate IPv4 to /24, hash with
 * a rotating salt, 30-day retention — a deliberate decision, not a default.
 *
 * Route and date are stored, and are not personal data — they describe the query, not the
 * querent.
 */
@Schema({ collection: 'search_events', timestamps: { createdAt: true, updatedAt: false } })
export class SearchEvent {
  /** Denormalised `DEL-BOM`, indexed — the field almost every analytics question groups by. */
  @Prop({ required: true, index: true })
  route!: string;

  @Prop({ required: true })
  origin!: string;

  @Prop({ required: true })
  destination!: string;

  @Prop({ required: true })
  departureDate!: string;

  @Prop({ required: true })
  passengers!: number;

  @Prop({ required: true })
  cabinClass!: string;

  @Prop({ type: [ProviderOutcomeSchema], default: [] })
  providers!: ProviderOutcomeRecord[];

  @Prop({ required: true })
  totalOffers!: number;

  @Prop({ required: true })
  totalGroups!: number;

  /**
   * Groups sold by more than one provider.
   *
   * The single most interesting number here: it is deduplication working, measured on real
   * traffic rather than asserted in a test.
   */
  @Prop({ required: true })
  multiProviderGroups!: number;

  @Prop({ required: true })
  tookMs!: number;

  @Prop({ required: true })
  cached!: boolean;

  /** True when at least one provider failed — the partial-results rate over time. */
  @Prop({ required: true, index: true })
  partial!: boolean;

  @Prop({ required: true })
  providersSucceeded!: number;

  @Prop({ required: true })
  providersAttempted!: number;

  /** Ties an event back to the response the client received, and to the server logs. */
  @Prop({ required: true })
  searchId!: string;

  createdAt!: Date;
}

export type SearchEventDocument = HydratedDocument<SearchEvent>;
export const SearchEventSchema = SchemaFactory.createForClass(SearchEvent);

// Supports "recent searches" and any time-bounded aggregate without a collection scan.
SearchEventSchema.index({ createdAt: -1 });
