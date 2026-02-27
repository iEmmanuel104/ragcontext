import type { PlanTier, FeatureFlags, FeatureFlagsByPlan } from "@contextinject/types";

/**
 * Default feature flags per plan tier.
 *
 * - **free**       – all advanced features disabled
 * - **pro**        – compression and semanticCache enabled
 * - **enterprise** – every feature enabled
 */
const FLAG_DEFAULTS: FeatureFlagsByPlan = {
  free: {
    colpali: false,
    crag: false,
    compression: false,
    semanticCache: false,
    bgeM3Embedding: false,
    threeTierMemory: false,
  },
  pro: {
    colpali: false,
    crag: false,
    compression: true,
    semanticCache: true,
    bgeM3Embedding: false,
    threeTierMemory: false,
  },
  enterprise: {
    colpali: true,
    crag: true,
    compression: true,
    semanticCache: true,
    bgeM3Embedding: true,
    threeTierMemory: true,
  },
};

/**
 * Return the default {@link FeatureFlags} for a given plan tier.
 */
export function getFeatureFlags(plan: PlanTier): FeatureFlags {
  return { ...FLAG_DEFAULTS[plan] };
}

/**
 * Check whether a single feature flag is enabled for a plan tier.
 */
export function isFeatureEnabled(plan: PlanTier, flag: keyof FeatureFlags): boolean {
  return FLAG_DEFAULTS[plan][flag];
}

/**
 * Return effective feature flags for a tenant, merging the plan defaults
 * with optional per-tenant overrides.
 *
 * Overrides can only *enable* or *disable* individual flags — the base
 * set is always the plan's defaults.
 */
export function getEffectiveFlags(plan: PlanTier, overrides?: Partial<FeatureFlags>): FeatureFlags {
  const base = getFeatureFlags(plan);

  if (!overrides) {
    return base;
  }

  return { ...base, ...overrides };
}
