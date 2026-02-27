# Pricing Model

> Detailed pricing strategy with unit economics, competitor benchmarks, revenue projections, and monetization timeline for ContextInject.

---

## 1. Four-Tier Architecture Overview

ContextInject uses a four-tier pricing model designed to capture developers at $0 and expand to $250K+/year enterprise contracts. This follows the proven PLG (Product-Led Growth) model used by Supabase, Stripe, and Pinecone.

| Tier       | Price                 | Target User           | Primary Purpose                                    |
| ---------- | --------------------- | --------------------- | -------------------------------------------------- |
| Free       | $0/mo                 | Individual developers | Create champions who prototype and demo internally |
| Starter    | $99/mo                | Small teams, startups | Production applications validating PMF             |
| Pro        | $499/mo               | Growth-stage teams    | Scaling applications with advanced features        |
| Enterprise | $2,000+/mo ($24K+/yr) | Large organizations   | Regulated industries, high-volume deployments      |

---

## 2. Per-Tier Breakdown

### 2.1 Free Tier (Developer)

| Feature          | Limit               |
| ---------------- | ------------------- |
| Documents        | 1,000               |
| Pages            | 10,000              |
| Retrievals/month | 5,000               |
| Projects         | 1                   |
| Users            | 1                   |
| Connectors       | Direct upload only  |
| Support          | Community (Discord) |
| Embedding model  | Cohere v4 (shared)  |
| Reranking        | Basic (top-5)       |
| Analytics        | 7-day history       |
| API rate limit   | 60 req/min          |
| Data retention   | 30 days query logs  |

**Strategic Purpose**: 70% of developers evaluate free tiers before recommending tools to their organizations. The free tier must be generous enough for a complete proof-of-concept — upload real documents, run real queries, see real quality scores. This is the top of the funnel.

**Cost to Serve**: ~$2-5/month per active free user (embedding costs + vector storage + compute share). At 5,000+ free users, this is $10K-25K/month — a customer acquisition cost.

### 2.2 Starter ($99/month)

| Feature          | Limit                               |
| ---------------- | ----------------------------------- |
| Documents        | Unlimited (within page limit)       |
| Pages            | 25,000                              |
| Retrievals/month | 50,000                              |
| Projects         | 3                                   |
| Users            | 3                                   |
| Connectors       | Direct upload, Notion, Google Drive |
| Support          | Email (48h response SLA)            |
| Embedding model  | Cohere v4 (dedicated quota)         |
| Reranking        | Cohere Rerank 3.5                   |
| Analytics        | 30-day history                      |
| API rate limit   | 300 req/min                         |
| Data retention   | 90 days query logs                  |
| Webhooks         | Yes                                 |
| **Overage**      | $0.002/page/mo + $0.001/retrieval   |

**Strategic Purpose**: Convert free users into paying customers. $99 is the psychological threshold where individual developers can expense without procurement. Startups validating product-market fit start here.

**Overage Model**: Predictable and transparent. A customer at 30K pages and 60K retrievals pays $99 + (5K _ $0.002) + (10K _ $0.001) = $99 + $10 + $10 = $119/month. No surprise bills.

### 2.3 Pro ($499/month)

| Feature          | Limit                               |
| ---------------- | ----------------------------------- |
| Documents        | Unlimited                           |
| Pages            | 100,000                             |
| Retrievals/month | Unlimited (fair use: 500K/mo)       |
| Projects         | Unlimited                           |
| Users            | 10                                  |
| Connectors       | All connectors                      |
| Support          | Priority email (24h response SLA)   |
| Embedding model  | Cohere v4 (higher quota)            |
| Reranking        | Cohere Rerank 3.5 with custom top-N |
| Compression      | LLMLingua-2 context compression     |
| Analytics        | 90-day history + quality dashboard  |
| API rate limit   | 1,000 req/min                       |
| Data retention   | Configurable (up to 1 year)         |
| Webhooks         | Yes                                 |
| Hybrid search    | Dense + BM25                        |
| Semantic caching | Yes                                 |
| MCP server       | Yes                                 |
| Quality scoring  | Context Quality Score API           |

**Strategic Purpose**: Growth-stage production applications. The jump from $99 to $499 is justified by unlimited retrievals, advanced features (compression, quality scoring, MCP), and priority support.

### 2.4 Enterprise ($2,000+/month, $24K/year base)

| Feature             | Limit                                                            |
| ------------------- | ---------------------------------------------------------------- |
| Documents           | Unlimited                                                        |
| Pages               | Unlimited                                                        |
| Retrievals          | Unlimited                                                        |
| Projects            | Unlimited                                                        |
| Users               | Unlimited                                                        |
| Connectors          | All + custom connector development                               |
| Support             | Dedicated Slack channel, 4h response SLA, named support engineer |
| SSO/SAML            | Yes (Okta, Azure AD, OneLogin)                                   |
| Audit logs          | Full audit trail with SIEM export                                |
| RBAC                | Advanced roles and permissions                                   |
| SLA                 | 99.9%+ uptime                                                    |
| Data residency      | Region selection (US, EU, APAC)                                  |
| Private deployment  | Dedicated infrastructure option                                  |
| VPC peering         | Yes (at $100K+/yr tier)                                          |
| BYOK encryption     | Yes                                                              |
| IP allowlisting     | Yes                                                              |
| Custom retention    | Yes                                                              |
| SOC 2 report access | Yes                                                              |
| Onboarding          | White-glove setup with dedicated engineer                        |

**Scaling Enterprise Pricing**:

| Usage Level     | Annual Price     | Features                               |
| --------------- | ---------------- | -------------------------------------- |
| Base            | $24K/yr ($2K/mo) | Standard enterprise features           |
| Growth          | $50K-$100K/yr    | Higher limits, premium support         |
| Scale           | $100K-$250K/yr   | Dedicated infrastructure, custom SLAs  |
| VPC/On-premises | $100K-$500K/yr   | Private deployment, VPC peering, HIPAA |

---

## 3. Unit Economics Per Tier

### Cost to Serve Breakdown

| Cost Component                    | Per Query         | Per Document Ingested | Notes                                           |
| --------------------------------- | ----------------- | --------------------- | ----------------------------------------------- |
| Cohere Embed v4 (query)           | $0.000012         | N/A                   | 100 tokens avg query, $0.12/M tokens            |
| Cohere Embed v4 (document)        | N/A               | $0.0001-$0.0005       | 500-2500 tokens per doc                         |
| Cohere Rerank 3.5                 | $0.002            | N/A                   | $2/1K searches                                  |
| Qdrant vector search              | $0.0005           | $0.00001              | Amortized infrastructure cost                   |
| PostgreSQL                        | $0.0001           | $0.00005              | Amortized infrastructure cost                   |
| Redis cache                       | $0.00005          | N/A                   | Cache layer, high hit rate reduces overall cost |
| Compute (API + Worker)            | $0.001            | $0.002                | Server time per operation                       |
| **Total per query**               | **$0.004-$0.005** | —                     | Without reranking                               |
| **Total per query (with rerank)** | **$0.006-$0.008** | —                     | With Cohere Rerank 3.5                          |
| **Total per document**            | —                 | **$0.002-$0.005**     | Parse + chunk + embed + store                   |

### Margin Analysis Per Tier

| Tier              | Revenue/mo | Est. Cost to Serve | Gross Margin | Notes                                            |
| ----------------- | ---------- | ------------------ | ------------ | ------------------------------------------------ |
| Free              | $0         | $2-5/user          | -100%        | Customer acquisition cost                        |
| Starter ($99)     | $99        | $25-35             | 65-75%       | 50K retrievals at $0.006 = $30                   |
| Pro ($499)        | $499       | $80-150            | 70-84%       | Higher volume, caching reduces per-query cost    |
| Enterprise ($2K+) | $2,000+    | $200-500           | 75-90%       | Dedicated resources, but higher margins at scale |

**Key Insight**: Gross margins of 65-75% on Starter and 70-90% on Pro/Enterprise are strong for infrastructure SaaS. The main margin risk is LLM generation costs — we mitigate this with BYOLLM (Bring Your Own LLM) as the default strategy.

---

## 4. LLM Generation as Margin Risk — BYOLLM Strategy

ContextInject is a **context middleware**, not an LLM provider. Our pipeline ends at context assembly — we deliver optimized context to the customer's LLM of choice.

| Strategy                       | Implementation                                                | Margin Impact                      |
| ------------------------------ | ------------------------------------------------------------- | ---------------------------------- |
| **BYOLLM (default)**           | Customer provides their own LLM API key                       | No LLM cost to us — highest margin |
| **Hosted generation (add-on)** | Optional: route through our LLM proxy                         | Pass-through + 20% markup          |
| **Context-only API**           | Default mode: return assembled context, not generated answers | Simplest, most profitable          |

By focusing on the context layer and letting customers bring their own LLM, we avoid the highest-cost and lowest-margin part of the RAG pipeline.

---

## 5. Competitor Pricing Benchmarks

### Direct Competitors

| Competitor          | Free Tier                  | Starter                 | Pro/Growth        | Enterprise                    |
| ------------------- | -------------------------- | ----------------------- | ----------------- | ----------------------------- |
| **Ragie**           | 1K pages free              | $100/mo                 | $500/mo           | Custom                        |
| **Pinecone**        | 100 namespaces, 1M vectors | Serverless: pay-per-use | Pods: $70-$350/mo | Custom                        |
| **Qdrant Cloud**    | 1GB free forever           | $25/mo + usage          | $100-$500/mo      | Custom                        |
| **Unstructured.io** | 14-day trial               | $0.03/page (API)        | Volume pricing    | Custom                        |
| **Vectara**         | Limited free               | N/A                     | N/A               | $100K+/yr minimum             |
| **Glean**           | None                       | None                    | None              | $50+/user/mo ($66K/yr median) |
| **AWS Bedrock KB**  | None                       | $350/mo floor           | Usage-based       | N/A                           |

### Pricing Positioning

```
$0        $99       $499      $2K       $24K      $100K     $500K
|---------|---------|---------|---------|---------|---------|
Free      Starter   Pro       Ent Base  Ent Scale  VPC

Ragie:    [$0-------$100------$500------Custom----]
Pinecone: [$0--$70--$350+-----Custom--------------]
Vectara:  [                             $100K+----]
Glean:    [                             $66K------$500K+]
AWS:      [    $350-----------Usage-based---------]
```

**ContextInject occupies the most accessible position**: $0 to start with the clearest upgrade path to $500K/yr enterprise.

---

## 6. Revenue Projection Model

### Year 1 Target: $500K-$1.5M ARR

**Assumptions**:

- Launch in Month 4 (public)
- Free tier sign-ups: 200-500/month (growing to 1,000/month by Month 12)
- Total free users by end of Year 1: 5,000-10,000
- Free-to-Starter conversion: 2-5% (100-500 converting)
- Starter-to-Pro upgrade: 10-20% of Starter (10-100)
- Pro-to-Enterprise: 3-5% of Pro (1-5 deals)
- Average revenue per paying customer: $150-$400/month

| Month                | Free Users | Starter | Pro | Enterprise | MRR             |
| -------------------- | ---------- | ------- | --- | ---------- | --------------- |
| 4 (launch)           | 200        | 5       | 0   | 0          | $495            |
| 6                    | 1,000      | 20      | 2   | 0          | $2,978          |
| 8                    | 2,500      | 50      | 8   | 1          | $8,942          |
| 10                   | 4,000      | 80      | 15  | 2          | $16,395         |
| 12                   | 6,000      | 120     | 25  | 3          | $30,380         |
| **Year 1 Total ARR** |            |         |     |            | **$365K-$1.5M** |

### Year 2 Target: $3M-$8M ARR

**Growth Drivers**:

- Word-of-mouth from Year 1 customers
- Open-source community growth (1,000+ GitHub stars)
- Partnership integrations (LangChain, LlamaIndex, MCP ecosystem)
- SOC 2 Type I certification opens enterprise pipeline
- Content marketing and conference presence

| Metric                 | Year 2 Target |
| ---------------------- | ------------- |
| Free users             | 20,000-50,000 |
| Starter customers      | 300-800       |
| Pro customers          | 50-150        |
| Enterprise contracts   | 5-10          |
| Average enterprise ACV | $50K-$200K    |
| Net revenue retention  | 130%+         |
| MRR end of Year 2      | $250K-$667K   |

### Year 3 Target: $10M-$25M ARR

| Metric                 | Year 3 Target  |
| ---------------------- | -------------- |
| Free users             | 50,000-100,000 |
| Starter customers      | 800-2,000      |
| Pro customers          | 150-500        |
| Enterprise contracts   | 20-50          |
| Average enterprise ACV | $100K-$250K    |
| Net revenue retention  | 140%+          |
| MRR end of Year 3      | $833K-$2.08M   |

---

## 7. Conversion Funnel

```
Website visitors (100%)
  |
  v
Sign up for free tier (5-10% of visitors)
  |
  v
Activate (upload first document + first query) (60-70% of sign-ups)
  |
  v
Regular usage (>10 queries/week for 4+ weeks) (30-40% of activated)
  |
  v
Hit free tier limits or need team features (50-60% of regular users)
  |
  v
Convert to Starter ($99/mo) — 2-5% of all free users
  |
  v
Grow usage, need advanced features — 10-20% of Starter upgrade to Pro
  |
  v
Enterprise signals (SSO request, security questionnaire) — 3-5% of Pro
```

### Conversion Optimization Tactics

| Stage            | Tactic                                                       | Expected Impact        |
| ---------------- | ------------------------------------------------------------ | ---------------------- |
| Signup           | "Time to first RAG query" under 3 minutes                    | 2x activation rate     |
| Activation       | In-app walkthrough: upload → query → see results             | 1.5x activation        |
| Retention        | Weekly email: quality score trends, usage stats              | 1.3x retention         |
| Upgrade trigger  | Usage dashboard showing % of limit consumed                  | 1.5x conversion        |
| Starter → Pro    | Feature gating: reranking, compression, MCP shown but locked | 1.4x upgrade           |
| Pro → Enterprise | Proactive outreach when multiple users from same domain      | 2x enterprise pipeline |

---

## 8. Enterprise Pricing Strategy

### Discovery and Negotiation

| Signal                                  | Action                                |
| --------------------------------------- | ------------------------------------- |
| Multiple users from same company domain | Outbound: offer team trial            |
| User asks about SSO/SAML                | Trigger enterprise sales conversation |
| Security questionnaire received         | Provide SOC 2 report, schedule call   |
| Usage exceeds Pro limits consistently   | Proactive upgrade conversation        |
| Request for custom connector            | Enterprise engagement                 |

### Enterprise Deal Structure

| Component                | Price Range            | Notes                          |
| ------------------------ | ---------------------- | ------------------------------ |
| Base platform            | $24K-$50K/yr           | Core RAG middleware access     |
| Additional users         | $100-$200/user/yr      | Volume discounts at 50+ users  |
| Priority support         | $5K-$20K/yr            | Named support engineer, 4h SLA |
| Custom connectors        | $10K-$50K one-time     | Development + maintenance      |
| Data residency (EU/APAC) | $5K-$15K/yr premium    | Regional deployment cost       |
| SSO/SAML                 | Included in Enterprise | No additional cost             |
| Audit logs + SIEM export | Included in Enterprise | No additional cost             |
| VPC deployment           | $100K-$500K/yr         | Dedicated infrastructure       |
| HIPAA compliance         | $25K-$50K/yr premium   | Enhanced controls + BAA        |

### Expansion Revenue

Follow the Datadog pattern: 12% of customers at $100K+/yr represent 86% of ARR.

| Expansion Lever        | Mechanism                                        |
| ---------------------- | ------------------------------------------------ |
| User growth            | Per-user pricing component                       |
| Document volume        | Page-based scaling                               |
| Additional projects    | Department-level rollout                         |
| New connectors         | Custom integration development                   |
| Premium features       | Quality scoring, compression, advanced analytics |
| Infrastructure upgrade | Dedicated → VPC → on-premises                    |

---

## 9. Usage Metering Implementation

### Events Table Schema

```typescript
// packages/db/src/schema/usage-events.ts (already in @ci/db)
export const usageEvents = pgTable("usage_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  eventType: varchar("event_type", { length: 50 }).notNull(),
  quantity: integer("quantity").notNull().default(1),
  metadata: jsonb("metadata").notNull().default({}),
  billedAt: timestamp("billed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
```

### Event Types

| Event Type       | Trigger                         | Quantity                   |
| ---------------- | ------------------------------- | -------------------------- |
| `page_ingested`  | Document processing complete    | Number of pages            |
| `retrieval`      | Query API called                | 1 per query                |
| `rerank`         | Reranking used                  | 1 per rerank call          |
| `cache_hit`      | Semantic cache hit (not billed) | 0 (informational)          |
| `connector_sync` | Connector sync completed        | Number of documents synced |

### Aggregation and Billing

```
Every hour: Aggregate usage_events per tenant
  -> Store in usage_aggregates (tenantId, period, eventType, total)

Every billing cycle (monthly):
  -> Calculate total usage per tenant
  -> Compare against tier limits
  -> Calculate overage if applicable
  -> Report to Stripe via meter events API
  -> Mark events as billed (billedAt timestamp)
```

### Stripe Integration

- Stripe Subscriptions for base tier pricing
- Stripe Billing Meter for usage-based overages
- Stripe Customer Portal for self-serve plan management
- Stripe Webhooks for subscription lifecycle events
- Founding Members program: Stripe coupon codes with lifetime percentage discount

---

## 10. Founding Members Program

### Structure

| Benefit             | Detail                                                             |
| ------------------- | ------------------------------------------------------------------ |
| Lifetime discount   | 30% off any paid tier, forever                                     |
| Direct Slack access | Private Slack channel with founders                                |
| Feature input       | Priority access to beta features, direct roadmap input             |
| Early adopter badge | Profile badge in dashboard and community                           |
| Limit               | First 50 paying customers                                          |
| Qualification       | Convert from free to any paid tier within first 6 months of launch |

### Economics

- 50 Founding Members at Starter ($99 \* 0.7 = $69.30/mo) = $3,465/mo
- If 20% upgrade to Pro ($499 \* 0.7 = $349.30/mo) = $3,493/mo for 10 users
- Total Founding Member revenue: ~$7K/mo = $84K/yr
- The lifetime discount is acceptable because these are your most valuable customers (testimonials, referrals, product feedback)

---

## 11. Monetization Timeline

| Month | Milestone           | Pricing Action                                      |
| ----- | ------------------- | --------------------------------------------------- |
| 1-3   | Private beta        | Free only — no payment required                     |
| 4     | Public launch       | Free + Starter ($99/mo) available                   |
| 4-6   | Founding Members    | 30% lifetime discount for first 50 paying customers |
| 6     | Feature expansion   | Pro ($499/mo) tier introduced                       |
| 8     | SOC 2 Type I        | Enterprise pricing enabled ($2K+/mo)                |
| 9-12  | Enterprise sales    | First enterprise contracts ($24K-$100K/yr)          |
| 12    | Usage-based billing | Overage billing activated for Starter tier          |
| 18    | VPC options         | High-end enterprise pricing ($100K-$500K/yr)        |

---

## 12. Cross-References

- Competitor pricing: [COMPETITOR_ANALYSIS.md](./COMPETITOR_ANALYSIS.md)
- Tech stack costs: [TECH_STACK_DECISIONS.md](./TECH_STACK_DECISIONS.md)
- Launch strategy: [Phase 6 Launch Checklist](../phases/phase-06-launch/04-launch-checklist.md)
- Security for enterprise: [SECURITY_CONTROLS.md](../compliance/SECURITY_CONTROLS.md)
- SOC 2 for enterprise gate: [SOC2_ROADMAP.md](../compliance/SOC2_ROADMAP.md)
