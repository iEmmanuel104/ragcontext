# 02 — Billing

> **Integration**: Stripe Billing + Stripe Metering APIs
> **Service**: `apps/api/src/services/billing-service.ts`
> **Webhook**: `apps/api/src/routes/v1/webhooks/stripe.ts`

---

## Overview

Billing is implemented via Stripe with four pricing tiers (Free, Starter, Pro, Enterprise). The system uses Stripe Billing for subscription management, Stripe Metering for usage tracking, and Stripe Webhooks for event-driven subscription lifecycle management.

Usage metering tracks three dimensions: pages ingested, retrievals executed, and storage consumed. The Free tier enforces hard limits (requests rejected after limit). Starter and Pro tiers allow overage billing. Enterprise uses custom contracts.

---

## Pricing Tiers

| Tier       | Monthly Price | Pages     | Retrievals/mo        | Projects  | Users     | Overage                        |
| ---------- | ------------- | --------- | -------------------- | --------- | --------- | ------------------------------ |
| Free       | $0            | 10K       | 5K                   | 1         | 1         | Hard limit (rejected)          |
| Starter    | $99           | 25K       | 50K                  | 3         | 3         | $0.002/page + $0.001/retrieval |
| Pro        | $499          | 100K      | Unlimited (fair use) | Unlimited | 10        | $0.001/page                    |
| Enterprise | $2K+          | Unlimited | Unlimited            | Unlimited | Unlimited | Custom contract                |

---

## Stripe Product Configuration

```typescript
// apps/api/src/services/billing-service.ts
import Stripe from "stripe";
import { db } from "@ci/db";
import { tenants, usageEvents } from "@ci/db/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import { logger } from "@ci/logger";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-12-18.acacia",
});

// Stripe Product/Price IDs (configured in Stripe Dashboard)
const PLAN_PRICES: Record<string, string> = {
  starter: process.env.STRIPE_PRICE_STARTER!, // $99/mo
  pro: process.env.STRIPE_PRICE_PRO!, // $499/mo
  enterprise: process.env.STRIPE_PRICE_ENTERPRISE!, // $2000/mo base
};

// Stripe Meter IDs for usage-based billing
const METERS = {
  pagesIngested: process.env.STRIPE_METER_PAGES!,
  retrievals: process.env.STRIPE_METER_RETRIEVALS!,
};

export class BillingService {
  /**
   * Create a Stripe customer for a new tenant.
   */
  async createCustomer(tenantId: string, email: string, name: string): Promise<string> {
    const customer = await stripe.customers.create({
      email,
      name,
      metadata: { tenantId },
    });

    await db.update(tenants).set({ stripeCustomerId: customer.id }).where(eq(tenants.id, tenantId));

    return customer.id;
  }

  /**
   * Create a checkout session for plan upgrade.
   */
  async createCheckoutSession(
    tenantId: string,
    plan: "starter" | "pro" | "enterprise",
    successUrl: string,
    cancelUrl: string,
  ): Promise<string> {
    const tenant = await this.getTenant(tenantId);

    const session = await stripe.checkout.sessions.create({
      customer: tenant.stripeCustomerId!,
      mode: "subscription",
      line_items: [{ price: PLAN_PRICES[plan], quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { tenantId, plan },
    });

    return session.url!;
  }

  /**
   * Report usage to Stripe Metering.
   * Called after each retrieval and page ingestion.
   */
  async reportUsage(tenantId: string, eventType: "retrieval" | "page_ingested", quantity = 1) {
    const tenant = await this.getTenant(tenantId);

    // Record in our database for analytics
    await db.insert(usageEvents).values({
      tenantId,
      eventType,
      quantity,
    });

    // Free tier: check hard limits, don't report to Stripe
    if (tenant.plan === "free") {
      await this.enforceFreeTierLimits(tenantId, eventType);
      return;
    }

    // Paid tiers: report to Stripe Meter
    if (!tenant.stripeCustomerId) return;

    const meterId = eventType === "retrieval" ? METERS.retrievals : METERS.pagesIngested;

    await stripe.billing.meterEvents.create({
      event_name: meterId,
      payload: {
        stripe_customer_id: tenant.stripeCustomerId,
        value: String(quantity),
      },
    });
  }

  /**
   * Enforce hard limits for the Free tier.
   * Throws an error if limits are exceeded.
   */
  private async enforceFreeTierLimits(tenantId: string, eventType: string) {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [usage] = await db
      .select({
        total: sql<number>`COALESCE(SUM(${usageEvents.quantity}), 0)`,
      })
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.tenantId, tenantId),
          eq(usageEvents.eventType, eventType),
          gte(usageEvents.createdAt, startOfMonth),
        ),
      );

    const limits: Record<string, number> = {
      retrieval: 5_000,
      page_ingested: 10_000,
    };

    const limit = limits[eventType] ?? Infinity;
    if (usage.total >= limit) {
      throw new Error(
        `Free tier limit exceeded for ${eventType}. ` +
          `Used ${usage.total}/${limit} this month. Upgrade to continue.`,
      );
    }
  }

  /**
   * Get current usage for a tenant this billing period.
   */
  async getCurrentUsage(tenantId: string): Promise<{
    pagesIngested: number;
    retrievals: number;
    periodStart: Date;
    periodEnd: Date;
  }> {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const endOfMonth = new Date(startOfMonth);
    endOfMonth.setMonth(endOfMonth.getMonth() + 1);

    const results = await db
      .select({
        eventType: usageEvents.eventType,
        total: sql<number>`COALESCE(SUM(${usageEvents.quantity}), 0)`,
      })
      .from(usageEvents)
      .where(and(eq(usageEvents.tenantId, tenantId), gte(usageEvents.createdAt, startOfMonth)))
      .groupBy(usageEvents.eventType);

    const usageMap = Object.fromEntries(results.map((r) => [r.eventType, r.total]));

    return {
      pagesIngested: usageMap["page_ingested"] ?? 0,
      retrievals: usageMap["retrieval"] ?? 0,
      periodStart: startOfMonth,
      periodEnd: endOfMonth,
    };
  }

  /**
   * Create a Stripe Customer Portal session for payment management.
   */
  async createPortalSession(tenantId: string, returnUrl: string): Promise<string> {
    const tenant = await this.getTenant(tenantId);

    const session = await stripe.billingPortal.sessions.create({
      customer: tenant.stripeCustomerId!,
      return_url: returnUrl,
    });

    return session.url;
  }

  private async getTenant(tenantId: string) {
    const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!tenant) throw new Error("Tenant not found");
    return tenant;
  }
}
```

---

## Stripe Webhook Handler

```typescript
// apps/api/src/routes/v1/webhooks/stripe.ts
import { Router } from "express";
import Stripe from "stripe";
import { db } from "@ci/db";
import { tenants } from "@ci/db/schema";
import { eq } from "drizzle-orm";
import { logger } from "@ci/logger";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

export const stripeWebhookRouter = Router();

// Must use raw body for signature verification
stripeWebhookRouter.post("/", express.raw({ type: "application/json" }), async (req, res) => {
  const sig = req.headers["stripe-signature"] as string;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    logger.error({ err }, "Stripe webhook signature verification failed");
    return res.status(400).send("Webhook signature verification failed");
  }

  logger.info({ eventType: event.type, eventId: event.id }, "Stripe webhook received");

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const tenantId = session.metadata?.tenantId;
      const plan = session.metadata?.plan;
      if (tenantId && plan) {
        await db
          .update(tenants)
          .set({ plan: plan as any, updatedAt: new Date() })
          .where(eq(tenants.id, tenantId));
        logger.info({ tenantId, plan }, "Tenant plan upgraded");
      }
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      // Handle plan changes, cancellations, etc.
      await handleSubscriptionUpdate(subscription);
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      // Downgrade to free tier
      const customerId = subscription.customer as string;
      await db
        .update(tenants)
        .set({ plan: "free", updatedAt: new Date() })
        .where(eq(tenants.stripeCustomerId, customerId));
      logger.info({ customerId }, "Subscription cancelled, downgraded to free");
      break;
    }

    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      logger.warn({ customerId: invoice.customer }, "Payment failed");
      // Send payment failure notification (email)
      break;
    }

    case "invoice.payment_succeeded": {
      const invoice = event.data.object as Stripe.Invoice;
      logger.info(
        { customerId: invoice.customer, amount: invoice.amount_paid },
        "Payment succeeded",
      );
      break;
    }

    default:
      logger.debug({ eventType: event.type }, "Unhandled Stripe event");
  }

  res.json({ received: true });
});

async function handleSubscriptionUpdate(subscription: Stripe.Subscription) {
  const customerId = subscription.customer as string;
  const priceId = subscription.items.data[0]?.price.id;

  // Map Stripe price ID back to plan name
  const planMap: Record<string, string> = {
    [process.env.STRIPE_PRICE_STARTER!]: "starter",
    [process.env.STRIPE_PRICE_PRO!]: "pro",
    [process.env.STRIPE_PRICE_ENTERPRISE!]: "enterprise",
  };

  const plan = planMap[priceId] ?? "free";

  await db
    .update(tenants)
    .set({ plan: plan as any, updatedAt: new Date() })
    .where(eq(tenants.stripeCustomerId, customerId));
}
```

---

## Subscription Lifecycle

```
User clicks "Upgrade" in dashboard
        |
        v
Dashboard creates checkout session via API
        |
        v
User redirected to Stripe Checkout
        |
        v
User enters payment details
        |
        v
Stripe processes payment
        |
        +---> SUCCESS: Stripe sends checkout.session.completed webhook
        |     API updates tenant plan in database
        |     User redirected to success URL
        |
        +---> FAILURE: Stripe shows error
              User can retry or cancel
```

### Plan Changes

- **Upgrade**: Immediate access to new plan limits. Prorated billing.
- **Downgrade**: Takes effect at end of current billing period. Usage limits enforced at new level.
- **Cancel**: Subscription ends at period end. Tenant downgrades to Free. Data retained for 90 days.

---

## Invoice Generation

Stripe automatically generates invoices for each billing period. Invoices include:

- Base subscription fee
- Overage charges (pages and retrievals beyond plan limits)
- Prorated amounts for mid-cycle plan changes
- Tax (if configured)

Invoices are accessible via the Stripe Customer Portal and the dashboard billing page.

---

## Enterprise Custom Contracts

Enterprise customers ($2K+/mo) have custom contracts handled outside Stripe self-serve:

- Sales team creates a custom quote
- Contract signed via DocuSign or similar
- Manual Stripe subscription creation with custom pricing
- Dedicated invoicing schedule (monthly, quarterly, annual)
- Custom SLA terms attached to the contract
- Volume discounts for high-usage customers

---

## Testing Requirements

- Webhook signature validation: verify rejects tampered payloads
- Checkout session creation: verify correct price ID for each plan
- Usage metering: compare API usage logs vs. Stripe meter events (100% accuracy)
- Free tier enforcement: verify requests rejected at limit
- Subscription lifecycle: create -> upgrade -> downgrade -> cancel
- Prorated billing: verify correct amounts on mid-cycle changes
- Payment failure: verify notification is sent
- Idempotency: verify duplicate webhook events are handled safely

---

## Related Documentation

- [Phase 5 README](./README.md) — Phase overview
- [01-dashboard.md](./01-dashboard.md) — Dashboard billing page
- [Phase 3: API Server](../phase-03-api-sdk/01-api-server.md) — Billing service integration
