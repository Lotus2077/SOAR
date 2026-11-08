# Manus product baseline: tiers, credits and task API (decision 10) — 2026-11-08

Question ([issue #50](https://github.com/Lotus2077/SOAR/issues/50)): what do Manus's own
pages say about the facts behind owner decision 10 (review §5.10, item 10), funding a
Manus product baseline on a separate account (the "E4 option" of review §5.6)?

Status: **research only.** Nothing was bought, no Manus account was created or signed
into, no checkout was started and no terms were accepted. Every figure below was read
on **2026-11-08** from the linked first-party page. Whether to fund the baseline is the
owner's decision 10 ticket ([#60](https://github.com/Lotus2077/SOAR/issues/60)); spend
outside the USD 300 envelope and the new egress destination both need the owner's
explicit approval (PLAN.md §4).

## Bottom line

**Gist:** Manus now sells monthly credits at USD 0.005 each in 4,000-credit steps
(8,000 / 12,000 / 16,000 / 20,000 on the USD 40-and-up card), so the 9,000-16,200
credits that 18 runs at 500-900 credits need cost **USD 60-100 for one billing cycle
bought up front**, or about the list value of **USD 45-81** with a mid-cycle upgrade.
Unused monthly credits are cleared at each reset. The task API reports credits per task.
However, Manus's Master Services Agreement, which its Terms of Use say govern API use,
restricts benchmarking the service and building a competing product. The owner must
weigh that before funding.

- **The lead was correct and is extended.** The middle pricing card offers 8,000,
  12,000, 16,000 and 20,000 credits a month for USD 40, 60, 80 and 100. The USD 200 card
  has its own selector, running from 40,000 to 5,000,000 credits a month (USD 200 to
  20,000), and the per-credit price falls below USD 0.005 only above 40,000 (§1).
- **The review's "USD 80-200 if only three tiers exist" case does not arise.**
  Intermediate amounts exist at the same rate. Because they come in 4,000-credit steps,
  an up-front purchase costs the list value rounded up to the next step (§8).
- **Expiry is confirmed.** Monthly credits must be used within the subscription cycle
  and are cleared at renewal, on annual plans too. Daily refresh credits only run the
  Lite mode, so they do not count toward standard-mode research runs (§2).
- **Add-ons stay restricted and unpriced.** For individual accounts the Help Center
  limits add-on credits to the highest monthly-credit tier, and no page publishes their
  price. A docs page contradicts the restriction. For E4 they are unnecessary (§3).
- **The task API logs credits per task.** `task.detail` and `task.list` return
  `credit_usage` (total credits per task), and `usage.list` returns per-task cost, refund
  and grant records. Tokens, per-step credits, money and duration are not exposed (§4).
- **No deep-research figure is published.** Manus publishes no credits-per-research-task
  figure. Its own examples are 200, 360 and 900 credits for a chart, a web page and an
  app. The review's 500-900 band therefore remains a third-party estimate (§5).
- **Account terms carry four risks:** the MSA's benchmarking and competing-product
  restrictions; training use of content on individual plans (an opt-out is listed only
  for Team); a corporate status in transition (Meta acquired Manus on 2025-12-29, and
  Manus says it is returning to independence); and region-dependent subscription sales
  paused in August 2026 (§6).

## 1. Tiers, prices and selectable credit amounts

Source: the [pricing page](https://manus.im/pricing), read in a browser without signing
in. I selected each credit amount in turn under the Monthly toggle and again under the
Annually toggle, which advertises a 17% saving. Prices are in USD before tax; the
[Help Center](https://help.manus.im/en/articles/11711125-what-is-the-pricing-unit-for-manus-globally-can-i-pay-in-local-currency)
(2026-02-27) says all prices are set in USD, and
[another article](https://help.manus.im/en/articles/11813620-why-are-there-additional-charges)
(2025-12-15) says local sales tax (VAT, GST) may be added at checkout.

| Card (pricing page) | Monthly | Annual, shown per month | Monthly credits | Also listed on every paid card |
| --- | ---: | ---: | --- | --- |
| USD 20, standard usage | USD 20 | USD 17 | 4,000, no selector | 300 refresh credits a day, 20 concurrent tasks, 20 scheduled tasks |
| USD 40, customizable | USD 40-100 | USD 34-84 | Selector: 8,000 / 12,000 / 16,000 / 20,000 | same |
| USD 200, extended usage | USD 200-20,000 | USD 167-16,667 | Selector: 40,000 up to 5,000,000 | same |

Every selectable amount, as displayed on 2026-11-08:

| Monthly credits | Monthly price (USD) | USD per credit | Annual, shown per month, billed yearly (USD) |
| ---: | ---: | ---: | ---: |
| 4,000 | 20 | 0.00500 | 17 |
| 8,000 | 40 | 0.00500 | 34 |
| 12,000 | 60 | 0.00500 | 50 |
| 16,000 | 80 | 0.00500 | 67 |
| 20,000 | 100 | 0.00500 | 84 |
| 40,000 | 200 | 0.00500 | 167 |
| 63,000 | 300 | 0.00476 | 250 |
| 85,000 | 400 | 0.00471 | 334 |
| 110,000 | 500 | 0.00455 | 417 |
| 170,000 | 750 | 0.00441 | 625 |
| 230,000 | 1,000 | 0.00435 | 834 |
| 350,000 | 1,500 | 0.00429 | 1,250 |
| 480,000 | 2,000 | 0.00417 | 1,667 |
| 1,200,000 | 5,000 | 0.00417 | 4,167 |
| 2,400,000 | 10,000 | 0.00417 | 8,334 |
| 5,000,000 | 20,000 | 0.00400 | 16,667 |

Notes:

- **Annual totals.** Every annual per-month figure equals ten times the monthly price
  divided by twelve, rounded up. That is consistent with a yearly charge of ten monthly
  prices; this is an inference, because the individual cards do not show a yearly total.
  The [Team page](https://manus.im/team) does show US$200 per seat per year against
  US$20 per seat per month.
- **Plan names.** The pricing page shows no plan names. The Help Center's
  [pricing article](https://help.manus.im/en/articles/11711111-what-is-the-current-membership-pricing-for-manus)
  (updated 2026-10-23) presents the USD 20 and USD 40 entries as two Pro prices, each a
  starting price for its base credit amount. It does not list the USD 200 card. It also
  mentions a 7-day free trial on the USD 40 entry, which the pricing page does not show;
  the trial's credit allowance is not published, and the cash figures below ignore it.
- **Daily refresh credits.** A tooltip on the pricing page says these are for the
  Manus 2.0 Lite mode only. The
  [credit rules](https://help.manus.im/en/articles/11711097-what-are-the-rules-for-credits-consumption-and-how-can-i-obtain-them)
  (updated 2026-11-02) agree, and cap Free users' daily-credit use at 1,500 a month.
  They [reset at 00:00 UTC and do not accumulate](https://help.manus.im/en/articles/11711121-will-my-daily-refresh-credits-accumulate-or-reset)
  (2025-12-15).
- **Free plan.** USD 0, with 300 daily credits and one concurrent task (pricing
  article). A [2025-12-05 article](https://help.manus.im/en/articles/11813668-are-there-any-discounts-or-special-offers)
  promises 1,000 credits to every new user at registration; I did not confirm that this
  still applies. Free personal accounts run every API task on `lite`, whatever profile
  is requested ([task.create](https://open.manus.ai/docs/v2/task.create)).
- **Team** ([team page](https://manus.im/team)). From US$20 per seat per month or US$200
  per seat per year, at 4,000 credits per seat per month, pooled across the team. The
  page calculator stops at **2 seats**: 8,000 pooled credits for US$40 a month, or 2 ×
  8,000 = 16,000 for US$80 a month. Per-seat options run 4,000 / 8,000 / 12,000 /
  16,000 / 20,000 / 40,000 / 63,000 and up. Owners can buy add-on credits and turn on
  auto-purchase. The page says Manus never allows model training on your data. Team is
  governed by the Master Services Agreement (§6).

## 2. Credit expiry, rollover and plan changes

From the [credit rules](https://help.manus.im/en/articles/11711097-what-are-the-rules-for-credits-consumption-and-how-can-i-obtain-them)
(updated 2026-11-02) unless another source is linked:

- **Cycle.** Monthly credits arrive with the subscription and refresh on the same
  calendar date each month. Whatever is unused is cleared when the next cycle starts,
  with no rollover. Annual plans also refresh, and clear, monthly. Times are UTC+0.
- **Consumption order.** Event credits, then daily credits, then monthly credits, then
  add-on credits, then free credits.
- **Negative balance.** A task's last action can push the balance below zero. New tasks
  cannot start at or below zero, and the deficit clears at the next refresh.
- **Upgrades.** Upgrading mid-cycle keeps the original renewal date. Manus charges the
  price difference for the time remaining and issues the matching share of the credit
  difference. The [upgrade article's](https://help.manus.im/en/articles/11711099-how-can-i-upgrade-or-downgrade-my-subscription)
  (2026-04-24) Stripe example: moving from USD 20 to USD 40 half-way through a month
  costs USD 10 and adds 2,000 credits, which is USD 0.005 per credit. Downgrades take
  effect at the next renewal, and upgrades must be made on the platform where the
  subscription was bought.
- **Cancellation.** It stops the next renewal. Access lasts to the end of the period,
  with no refund for the current period
  ([cancel article](https://help.manus.im/en/articles/11711087-how-can-i-cancel-my-subscription),
  2026-10-01; [Terms of Use](https://manus.im/terms) §4.1). When a subscription ends,
  its monthly credits drop to 0; add-on and event credits become inactive until a paid
  subscription resumes
  ([2026-09-08 article](https://help.manus.im/en/articles/12268225-what-happens-to-my-credits-after-canceling-or-letting-my-manus-subscription-expire)).
- **Contract terms on credits** ([Terms of Use](https://manus.im/terms) §4.3-4.4, last
  updated 2026-09-28). Subscriptions renew automatically. Credits expire under Manus's
  credit rule, credit purchases are final except where the law requires a refund, and
  credits cannot leave the account they were issued to.
- **Credit refunds for failed tasks.** Manus refunds the credits in full when it
  confirms a platform fault. It does not refund unclear instructions, external-site
  failures or tasks stopped at a limit
  ([refund policy](https://help.manus.im/en/articles/12992237-how-does-our-ai-agent-s-credit-refund-policy-work),
  2025-12-16). An [earlier refund article](https://help.manus.im/en/articles/11985260-how-can-i-apply-for-a-credits-refund)
  (2026-02-13) also lists unsatisfactory outputs as refundable after verification, which
  conflicts with the policy article. Refunds appear as `refund` records in `usage.list`
  (§4).

## 3. Add-on credits

| Source | What it says |
| --- | --- |
| [Help Center, highest-tier article](https://help.manus.im/en/articles/13570051-what-should-i-do-if-i-still-don-t-have-enough-credits-after-upgrading-to-the-highest-tier-of-monthly-credits) (2026-02-05) | Add-ons are only for users on the highest tier of monthly credits, need an active paid subscription, and are bought from an add-credits option in the account menu. No price or pack sizes are given. |
| [Credit rules](https://help.manus.im/en/articles/11711097-what-are-the-rules-for-credits-consumption-and-how-can-i-obtain-them) (2026-11-02) and [cancellation effects](https://help.manus.im/en/articles/12268225-what-happens-to-my-credits-after-canceling-or-letting-my-manus-subscription-expire) (2026-09-08) | Add-ons carry over between cycles while a paid subscription stays active, and become inactive after it lapses or the account moves to Free. |
| [Credits page](https://manus.im/help/credits) (undated) and [docs, Plans and Pricing](https://manus.im/docs/introduction/plans) (undated) | Add-ons never expire. The docs page also says packs can be bought at any time, which contradicts the highest-tier rule. |
| [Team page](https://manus.im/team) | Team owners and super admins can buy add-ons and enable auto-purchase. |
| [API, usage.availableCredits](https://open.manus.ai/docs/v2/usage.availableCredits) | `addon_credits` counts separately purchased credits that do not reset with the subscription cycle. |

No first-party page read gives an add-on price, so the review's figure of about USD 0.01
per credit remains third-party. The highest-tier article does not say whether "highest
tier" means the USD 200 card or its largest amount (5,000,000 credits). For the E4
option this is moot, because the adjustable tiers sell any multiple of 4,000 credits up
to 20,000 at USD 0.005.

## 4. Task API: what it exposes about credits

API v2 lives at `https://api.manus.ai` ([introduction](https://open.manus.ai/docs/v2/introduction);
v1 is deprecated). Facts relevant to logging the E4 option:

- **Keys and limits.** Keys are created in the web app's developer settings, up to 50
  per account, and each key has full account access
  ([authentication](https://open.manus.ai/docs/v2/authentication)). Rate limits are per
  user and the same on every plan: `task.create` 10 a minute, `task.detail` and
  `task.listMessages` 100 a minute
  ([rate limits](https://open.manus.ai/docs/v2/rate-limits)). The docs do not say which
  plan the API needs, but a Free account would run everything on `lite`.
- **Creating tasks** ([task.create](https://open.manus.ai/docs/v2/task.create)).
  `agent_profile` is `standard` (the default), `lite` or `max`, and Max takes thinking
  levels `max-medium` to `max-ultra`; the docs describe the deepest level as using the
  most credits. `interactive_mode` defaults to false, `share_visibility` to `private`,
  and `hide_in_task_list` and `structured_output_schema` are optional. The user's message
  is limited to about 5,000 estimated tokens. Files can be attached through `file.upload`
  (up to 512 MB) or by URL or data URI (up to 20 MB).
- **Per-task credits** ([task.detail](https://open.manus.ai/docs/v2/task.detail),
  [task.list](https://open.manus.ai/docs/v2/task.list)). `credit_usage` is an int32
  total of the credits the task consumed, present once it has consumed any. The same
  object carries `agent_profile` for the latest turn (returned in the legacy
  `manus-1.6…` form), `created_at` and `updated_at`, `status` (`running`, `stopped`,
  `waiting` or `error`), `has_running_background_jobs` and `created_by_api_key`.
  `stopped` is not always final: background jobs can wake the task again
  ([task lifecycle](https://open.manus.ai/docs/v2/task-lifecycle)).
- **Credit ledger** ([usage.list](https://open.manus.ai/docs/v2/usage.list)). Credit
  changes are listed per task, newest first and paginated, with `task_id`, `title`,
  `credits` (negative for consumption, positive for refunds or grants), `type` (`cost`,
  `refund` or `grant`) and `created_at` (the time of the latest change). Only an API key
  or a trusted client may call it.
- **Balance** ([usage.availableCredits](https://open.manus.ai/docs/v2/usage.availableCredits)).
  `total_credits` plus its components (periodic, add-on, free, event and refresh
  credits), the plan's monthly quota and `current_period_end`.
- **Confirmation pauses** ([confirmation events](https://open.manus.ai/docs/v2/task-lifecycle/confirmation-events)).
  A Wide Research run (`mapreduceAction`) waits for `task.confirmAction`, and the
  documented example carries an `estimatedCost` pair whose units are not stated. A
  high-credit data-API call (`apiHighCreditNotice`) also waits, without exposing the
  amount.
- **Not exposed anywhere:** token counts, per-step credits, a money amount, a duration
  field (only timestamps) or the underlying model.

What follows for E4's logging (an inference): record `credit_usage` only once the task
is `stopped` with `has_running_background_jobs` false, then reconcile it against
`usage.list`, netting refunds against costs. USD per run is credits × the tier's USD
0.005: a list-value conversion, not an invoice, since it excludes tax and expiring
credits. Because unattended runs can stop at a confirmation pause, E4's card must
pre-register what the runner answers.

## 5. Credits per deep-research task

- **Manus's own examples.** The [credits page](https://manus.im/help/credits) (undated)
  gives three per-task examples, none of them a research report: a standard 15-minute
  data-visualization task, 200 credits; a standard 25-minute web page, 360; and a
  complex 80-minute web app, 900.
- **Estimates before a task.** Manus's sources disagree. The
  [Help Center](https://help.manus.im/en/articles/13185575-is-there-a-way-to-check-how-many-credits-a-task-will-cost-before-i-begin)
  (2025-12-18) says the system cannot predict a task's credits, and that the agent's own
  statements about cost should be treated as hallucinations. The undated
  [docs page](https://manus.im/docs/introduction/plans) says the dashboard gives
  estimates before a task starts. The [Trust Center FAQ](https://trust.manus.im/faq)
  says Manus shows an estimate and asks for confirmation before Wide Research, and
  absorbs any Wide Research overrun beyond it.
- **Wide Research limits.** It triggers automatically, is for paid users only, caps
  each sub-task at 50 credits and runs 20 sub-tasks at once
  ([article](https://help.manus.im/en/articles/11960169-what-is-wide-research),
  2026-09-30).
- **Manus 2.0.** The [launch post](https://manus.im/blog/introducing-manus-2-0)
  (2026-09-28) claims 32% lower running cost in one tested configuration, a vendor
  claim, and gives no per-task figure.

So no first-party figure supports or replaces the review's 500-900 credits per run. The
first logged E4-option runs would be the first measurement. The band concerns
`standard` runs; Max runs cost more, by an unpublished amount (§8 gives a sensitivity
figure).

## 6. Account and data terms that matter

| Topic | What Manus's documents say | Why it matters for the E4 option |
| --- | --- | --- |
| Which contract governs | The [Terms of Use](https://manus.im/terms) (2026-09-28) license individual use for the user's own personal purposes, and say the separate [Master Services Agreement](https://manus.im/policies/services-agreement) (effective 2025-11-28) governs the Team Plan, the APIs and services for businesses and developers. The MSA itself binds the entity that accepts an Order Form, online ordering included. | An individual Pro account driven through the API sits between the two documents. |
| Benchmarking and competing products | MSA §2.7 forbids using the service to build a similar or competitive product (f), and using any tools to "probe, scan, or attempt to penetrate or benchmark the Service" (j). The Terms of Use contain no benchmarking clause. | The E4 option exists to measure Manus and re-baseline SOAR's thresholds. Whether these clauses reach an individual account is a legal question for the owner; asking Manus in writing (api-support@manus.ai) before paying would settle it. This note is not legal advice. |
| Training use | Terms §5.3 give Manus a licence to use your inputs and outputs to provide, develop and improve the services. The [Privacy Policy](https://manus.im/privacy) (2026-09-28) allows de-identified data to improve models, and its retention section refers to users who allow content to be used to improve models. The pricing article lists a data-training opt-out as a **Team** feature, and the Team page says training on your data is never allowed. Third-party model providers are contractually barred from training on your data ([Trust Center FAQ](https://trust.manus.im/faq); Terms §5.4). | On an individual plan, assume the six task briefs and Manus's outputs may be used to improve Manus. Whether a personal opt-out setting exists could not be checked without signing in. |
| Retention | Task execution logs are kept for replay and debugging. Cloud sandbox data is deleted after 21 days on paid plans and 7 on Free. Deletion on request, to privacy@manus.im, completes within 30 days, except where legal, fraud or accounting holds apply ([Privacy Policy](https://manus.im/privacy); [account deletion](https://help.manus.im/en/articles/11711823-will-my-personal-data-be-deleted-after-i-delete-my-account), 2026-10-01). | Delete the account after the runs if the owner wants the data gone; tasks should stay `private`. |
| Where data goes | The controller is Butterfly Effect Pte. Ltd., incorporated in Singapore. Data is stored in the US and Singapore. Inputs are sent to third-party AI providers. [Subprocessors](https://trust.manus.im/subprocessors), all in the US: Google Cloud Platform (infrastructure and foundational models), Microsoft Azure AI Foundry, Amazon Web Services, Cloudflare, Intercom, OpenAI (foundational models), RevenueCat, Stripe and Twilio. | The briefs reach Manus and, through Manus, its model providers. |
| Separate account | Memberships cannot move between accounts ([article](https://help.manus.im/en/articles/11711108-can-i-transfer-my-membership-status-to-another-account), 2025-12-15). Credits are usable only by the account they were issued to (Terms §4.3). The Terms count using multiple accounts in promotional activities (events) as abuse; a separate paid account is not otherwise addressed. | A dedicated account is workable, but its credits cannot be pooled with any other account. |
| Corporate status and region | Manus's [blog](https://manus.im/blog/a-note-to-our-users) (2026-08-11) states that Meta acquired Manus on 2025-12-29, and that Manus is transitioning back to independent operations. From 2026-08-11 it paused new subscriptions in unnamed affected regions and deleted affected users' recent data to meet regulatory requirements ([service-change article](https://help.manus.im/en/articles/16147831-service-change-overview-what-s-happening-and-am-i-affected), 2026-08-21). The Privacy Policy still mentions sharing with a corporate parent, and Meta products in its California section. | Before paying, check the in-app notice to confirm the account's region can subscribe. Re-read the terms on the purchase day, since ownership and policies are changing. |

## 7. Egress beyond the prompts

From the SOAR side, the E4 option adds these destinations (from the API docs above):

1. **`api.manus.ai`:** the six task briefs, any attachments, follow-ups and the API key
   header.
2. **`manus.im`:** sign-up, API-key creation and subscription management, in the
   owner's own browser.
3. **The payment processor (Stripe):** the owner's billing details. Taxes may apply.
4. **Manus's file CDN:** result files download through temporary signed URLs (re-signed
   artifact URLs last 48 hours) on a Manus-managed private CDN, `private.manuscdn.com` in
   the docs' examples ([attachments](https://open.manus.ai/docs/v2/attachments),
   [artifacts](https://open.manus.ai/docs/v2/artifacts)). That is another host for the
   harness to contact.
5. **Onward processing:** Manus forwards inputs to its model providers (Google Cloud,
   OpenAI and Azure AI Foundry among the subprocessors). This is not a connection SOAR
   makes, but it is where the briefs end up.
6. **Web search and page reads happen inside Manus's cloud sandbox**, so the runs add no
   search destination on SOAR's side (unlike decision 8). Webhooks would add an inbound
   endpoint; polling `task.listMessages` avoids it.

Disclosure scope: the two LiveDRBench cases and two DeepResearch Bench prompts are
already public. The **two E4 planted-conflict briefs** would be disclosed (gold stays
local), so they stop being unseen with respect to Manus. The four held-out
planted-conflict tasks must never be sent. Task IDs, the account e-mail, key IDs and
user IDs that the API returns are account identifiers and must stay out of the public
repository (AGENTS.md).

## 8. Recomputed cash for about 18 runs

The review assumes 18 runs at 500-900 credits: 9,000-16,200 credits, USD 45-81 at USD
0.005. All runs must fall in one monthly cycle, because leftover monthly credits are
cleared at the reset.

| Credits per run | Credits for 18 runs | List value (USD) | Cheapest up-front purchase, one cycle | Credits left to expire |
| ---: | ---: | ---: | --- | ---: |
| 500 | 9,000 | 45 | 12,000 for USD 60 | 3,000 |
| 600 | 10,800 | 54 | 12,000 for USD 60 | 1,200 |
| 700 | 12,600 | 63 | 16,000 for USD 80 | 3,400 |
| 800 | 14,400 | 72 | 16,000 for USD 80 | 1,600 |
| 900 | 16,200 | 81 | 20,000 for USD 100 | 3,800 |

- **Up front: USD 60-100.** Buy one month at the step that covers the expected burn.
  Each step covers 18 runs up to an average of 444 credits a run (8,000, USD 40), 666
  (12,000, USD 60), 888 (16,000, USD 80), 1,111 (20,000, USD 100) or 2,222 (40,000,
  USD 200).
  Cancel renewal straight after purchase; access continues to the end of the period.
- **Lowest cash: about the list value, USD 45-81, with a floor of USD 40.** Subscribe at
  8,000 or 12,000 and upgrade mid-cycle only if the measured burn needs it. Prorated
  upgrade credits cost USD 0.005 or less, but they shrink with the time left, so upgrade
  early, for example after the first six runs. This rests on the Help Center's proration
  example and is untested here. The upgraded tier renews unless cancelled, and the docs
  do not say whether a subscription already set to cancel can still be upgraded.
- **Not cheaper:**
  - Two months at USD 40 cost the same as one at 16,000 and split the runs across
    cycles.
  - Annual billing saves 17% a month but commits a year, for example about USD 600 for
    12,000 a month, inferred from the displayed USD 50 a month.
  - Add-ons are closed below the highest tier and unpriced.
  - Team costs the same per credit (2-seat minimum: US$40 for 8,000, US$80 for 16,000)
    and sits squarely under the MSA.
  - Manus Flex runs Manus on the owner's own inference-provider key
    ([docs](https://manus.im/docs/models/manus-flex)), so it would not measure the
    product as sold and would add a provider egress.
- **Profile sensitivity (low confidence).** The review's third-party Max estimate of USD
  7.50-25 a run is 1,500-5,000 credits. Eighteen such runs need 27,000-90,000 credits,
  so USD 200 (40,000) to USD 500 (110,000) a cycle. E4's card must fix the profile; the
  500-900 band applies to `standard`.
- **Beyond Manus credits.** Possible sales tax, and the paid judges for 18 more outputs.
  E4 budgets up to USD 6 of judge fees for its 36 runs, so roughly half that again is an
  inference, not a quote.

## What this establishes and what it does not

Established: Manus's published prices and selectable amounts as displayed on 2026-11-08
(English page, USD, before tax, signed out); its published credit, expiry, refund and
add-on rules, including where they conflict; the documented v2 API fields; and the
first-party terms quoted by section.

Not established:

- the six E4 tasks' real credit burn on any profile;
- whether checkout shows the same amounts, or what tax it adds;
- whether a personal training opt-out exists;
- whether the owner's region can subscribe today;
- whether MSA §2.7 binds an individual account;
- add-on prices and the trial allowance;
- the effect of mid-cycle proration on a subscription set to cancel.

Prices and terms can change without notice (Terms §4.1 and §4.3), so re-check them on
the purchase day.

## Open points for the owner (decision 10, #60)

1. **Fund, defer or decline.** Funding is spend outside the USD 300 envelope and a new
   egress destination, so it needs one explicit approval entry naming the amount (for
   example "up to USD 100 plus tax, one cycle, `standard`") and the destinations in §7.
2. **Contract fit.** Decide whether MSA §2.7(f) and (j) block the purpose, ask Manus in
   writing, or decline.
3. **Profile and confirmations.** Choose `standard` or `max`, and set the runner's
   answer to Wide Research and high-credit confirmations, before the first run.
4. **Purchase shape.** Either 12,000, 16,000 or 20,000 up front (USD 60, 80 or 100), or
   start lower and upgrade early. In both cases all 18 runs run inside one cycle and
   renewal is cancelled at once.
5. **Account type.** An individual plan has no confirmed training opt-out. Team needs 2
   seats, never trains on your data and falls under the MSA. Either way, check region
   eligibility at sign-up.
6. **Grader inputs.** Decide how Manus's report becomes the graders' inputs (for example
   the `claims.json` that criterion 3 needs). Requesting it through
   `structured_output_schema` would change the product's behaviour.
7. **Logging.** Read `credit_usage` once a run is final, reconcile it with `usage.list`
   refunds, and keep identifiers out of the public repo. The result stays a product
   baseline, never mixed with same-harness arms (`benchmarks/README.md`).

## Sources (all read 2026-11-08)

| Source | Page date | Used for |
| --- | --- | --- |
| [Pricing page](https://manus.im/pricing) | live page | §1 prices, selectors, annual figures, daily-credit tooltip |
| [Team page](https://manus.im/team) | live page | §1 Team calculator, add-ons, no-training statement |
| [Help: membership pricing](https://help.manus.im/en/articles/11711111-what-is-the-current-membership-pricing-for-manus) | 2026-10-23 | §1 Pro naming, trial mention, Team training opt-out |
| [Help: credit rules](https://help.manus.im/en/articles/11711097-what-are-the-rules-for-credits-consumption-and-how-can-i-obtain-them) | 2026-11-02 | §2 expiry, order, upgrades, negative balance |
| [Help: daily refresh credits](https://help.manus.im/en/articles/11711121-will-my-daily-refresh-credits-accumulate-or-reset) | 2025-12-15 | §1 daily reset |
| [Help: upgrade or downgrade](https://help.manus.im/en/articles/11711099-how-can-i-upgrade-or-downgrade-my-subscription) | 2026-04-24 | §2 and §8 proration |
| [Help: cancel](https://help.manus.im/en/articles/11711087-how-can-i-cancel-my-subscription) | 2026-10-01 | §2 cancellation, trial handling |
| [Help: credits after cancel or expiry](https://help.manus.im/en/articles/12268225-what-happens-to-my-credits-after-canceling-or-letting-my-manus-subscription-expire) | 2026-09-08 | §2 and §3 |
| [Help: add-on credits at the highest tier](https://help.manus.im/en/articles/13570051-what-should-i-do-if-i-still-don-t-have-enough-credits-after-upgrading-to-the-highest-tier-of-monthly-credits) | 2026-02-05 | §3 |
| [Help: cost before a task](https://help.manus.im/en/articles/13185575-is-there-a-way-to-check-how-many-credits-a-task-will-cost-before-i-begin) | 2025-12-18 | §5 |
| [Help: credit refund policy](https://help.manus.im/en/articles/12992237-how-does-our-ai-agent-s-credit-refund-policy-work) and [credits refund](https://help.manus.im/en/articles/11985260-how-can-i-apply-for-a-credits-refund) | 2025-12-16; 2026-02-13 | §2 refunds |
| [Help: Wide Research](https://help.manus.im/en/articles/11960169-what-is-wide-research) | 2026-09-30 | §5 |
| [Help: pricing unit](https://help.manus.im/en/articles/11711125-what-is-the-pricing-unit-for-manus-globally-can-i-pay-in-local-currency) and [additional charges](https://help.manus.im/en/articles/11813620-why-are-there-additional-charges) | 2026-02-27; 2025-12-15 | §1 USD, tax |
| [Help: discounts](https://help.manus.im/en/articles/11813668-are-there-any-discounts-or-special-offers) and [membership transfer](https://help.manus.im/en/articles/11711108-can-i-transfer-my-membership-status-to-another-account) | 2025-12-05; 2025-12-15 | §1 sign-up credits; §6 |
| [Help: service change overview](https://help.manus.im/en/articles/16147831-service-change-overview-what-s-happening-and-am-i-affected) and [account deletion](https://help.manus.im/en/articles/11711823-will-my-personal-data-be-deleted-after-i-delete-my-account) | 2026-08-21; 2026-10-01 | §6 |
| [Credits page](https://manus.im/help/credits) and [docs: Plans and Pricing](https://manus.im/docs/introduction/plans) | undated | §3, §5 |
| [Docs: Manus Flex](https://manus.im/docs/models/manus-flex) | undated | §8 |
| API v2: [introduction](https://open.manus.ai/docs/v2/introduction), [authentication](https://open.manus.ai/docs/v2/authentication), [rate limits](https://open.manus.ai/docs/v2/rate-limits), [task.create](https://open.manus.ai/docs/v2/task.create), [task.detail](https://open.manus.ai/docs/v2/task.detail), [task.list](https://open.manus.ai/docs/v2/task.list), [usage.list](https://open.manus.ai/docs/v2/usage.list), [usage.availableCredits](https://open.manus.ai/docs/v2/usage.availableCredits), [task lifecycle](https://open.manus.ai/docs/v2/task-lifecycle), [confirmation events](https://open.manus.ai/docs/v2/task-lifecycle/confirmation-events), [attachments](https://open.manus.ai/docs/v2/attachments), [artifacts](https://open.manus.ai/docs/v2/artifacts) | live docs | §4, §7 |
| [Terms of Use](https://manus.im/terms), [Privacy Policy](https://manus.im/privacy), [Usage Policy](https://manus.im/usage) | 2026-09-28 | §2, §6 (the Usage Policy has no relevant clause) |
| [Master Services Agreement](https://manus.im/policies/services-agreement) | effective 2025-11-28 | §6 |
| [Trust Center FAQ](https://trust.manus.im/faq) and [subprocessors](https://trust.manus.im/subprocessors) | live pages | §5, §6, §7 |
| [Blog: a note to our users](https://manus.im/blog/a-note-to-our-users) and [Introducing Manus 2.0](https://manus.im/blog/introducing-manus-2-0) | 2026-08-11; 2026-09-28 | §5, §6 |
