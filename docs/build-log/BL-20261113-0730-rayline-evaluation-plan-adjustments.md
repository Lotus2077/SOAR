### BL-20261113-0730-rayline-evaluation-plan-adjustments -- 2026-11-13 -- Rayline (rayline.ai) evaluated against SOAR: no component adopted, eight patterns borrowed, and the owner-delegated plan adjustments that place them before E0, in items 10.b and 11, in a new item 17 and in the E3, decision 5 and decision 6 tickets

Status: `Approved`

Scope or hypothesis: On 2026-11-13 the owner asked whether Rayline (rayline.ai: the ARC learned model router; its Generation, Routes and Decisions APIs; the Raydock local gateway; and the Workshop app builder) could inspire or boost SOAR's development. After the findings, the owner instructed, quoted: "record and sync your learnings and adjust the current building plan if you see fit". This entry records the evaluation, the decisions that follow from it, and the plan adjustments made under that delegation. Method: one read-only run of nine agents. Three studied Rayline: its product and solutions pages; its primary technical sources (the ARC report dated 2026-11-10, the Hugging Face model card and configuration, the docs, and the Raydock and semantic-router repositories); and independent coverage plus the routing literature. Two mapped SOAR: its strategy and routing history, and its code seams. Two ideation lenses followed, each with one adversarial verifier that re-fetched sources and grepped this repository. No Rayline account, API call, download or paid request was made. The findings with their sources are on the unmerged branch `research/rayline` (docs/RAYLINE_RESEARCH.md).

Decisions: (1) Adopt no Rayline component, hosted or open source.
- The hosted Routes and Decisions services read whole conversations. Standard retention is up to 30 days, zero retention needs sales approval, and no sub-processor list is published.
- Raydock's hybrid mode posts each turn's request to the hosted decision service, including turns that then run locally.
- ARC cannot run locally end to end: `vllm-arc` serves only the encoder and the first stage on a pinned vLLM fork. The report (its Appendix B) says Raydock obtains decisions from an on-device service or the hosted API, but no on-device service has shipped. ARC is not calibrated for this endpoint's model, and adding a model needs Rayline's proprietary refit.
- Rayline's evidence is its own and unreplicated. The headline (97.4% of Opus 5.5's quality at 14.3% of its cost) averages quality per benchmark but pools cost, which DeepSWE dominates; per benchmark, cost averages about 25.8% of Opus. Tau3 Banking keeps 78%. No intervals are given, and the most-picked model has no single-model baseline. The evaluation chose the model at task start and held it for the episode, choosing only the reasoning level on each call, so switching models mid-task was not tested. About 90% of the training weight is Workshop traffic, so deep research lies outside ARC's training distribution.
- A router or gateway as decision 6's provider would weaken at-most-once dispatch, because the gateway retries and falls back upstream where the ledger cannot see it. It would also break the reservation, which assumes one fixed rate table (src/main/private-agent/model.ts:371-379).

The bars in docs/PLAN.md:135 and :1010-1011 and in docs/ROUTING_POLICY.md:95 stand. Revisit only when a local decision service ships and an independent evaluation on non-coding work exists, or once SOAR holds the evaluator-backed trajectories ROUTING_POLICY.md:95 requires.

(2) The evidence supports architecture v5's route model; it does not change it. Rayline's own evaluated configuration holds one model per task and changes only the reasoning level per call; its timing rules allow a model change only at a cache boundary or a user turn. The literature the run read ranks escalation after a verified failure above routing on prompt features alone (RouterBench, 2024). Two 2026 preprints find that handing a task to a stronger model mid-way recovers less than half the quality gap. SOAR's sealed one-shot packets, fired by two-strikes host signals, are escalation after a verified failure. No rule, cap or gate changes.

(3) Plan adjustments, made in docs/HANDOFF.md "Start here" §5 under the owner's delegation. Each is zero fee. A persisted-contract or permission change still gets its own decision entry before code. Card contents, owner decisions and paid runs stay the owner's.
- (a) Before E0: the doctor (scripts/setup-general.ts) reports the endpoint's served alias, model root basename, engine version and context window, never the address.
  - It flags a window smaller than the active profile's own request guard can fill: its body cap at 3 bytes per token plus its output limit, 234,838 tokens for heavy (src/main/private-agent/profiles.ts:17-21, which designs heavy for a 262,144-token window). Under `flash_next_v1` the floor is also at least the configured context.
  - When the serving-card pair is set, it is not ready if the adopted card's identity differs, and it names only the fields that differ.
  - Today it reads only the model ids from /models (setup-general.ts:81-83), and `ready` ignores both the window and the card (:114).
  - With this, the owner can answer decision 1 from observed values. It touches no file of an open pull request and no persisted contract.
- (b) Before E0's judge cell: a judge-fixture script and its labelling protocol.
  - No judge fixture exists; package.json has only `fixture:planner`.
  - A separate session labels the claims and plants unsupported and contradicted claims to reach a per-class minimum that the card fixes.
- (c) Proposals for the E0 card (issue #47), for the owner to decide:
  - a planner-fixture "sequence" condition: attempt 1 with thinking off, then attempt 2 with the repair diagnostics and thinking on. It reports the rescue rate, the replies that used the whole cap with no content, and wall seconds and tokens per attempt.
  - a low-effort or budgeted-thinking planner condition, run only if probe P2 shows that low and medium differ in reasoning tokens on the served template;
  - a logprobs sub-check in the adapter probe;
  - two judge cells on the labelled set. J1 is today's JSON judge, the only form that can activate criteria 3 and 8 for E3. J2 is a single-token, probability-scored form and stays descriptive. Both report agreement, the option-order flip rate and AUROC for "not established"; J2 adds calibration.
- (d) Items 10.b and 11, before E3's first source freeze: record the served model string (optional, bounded exact text) in three places: on assist attempt records, on `model_finished` events for cloud destinations, and as a registry column.
  - model.ts:406 returns the served model, but runner.ts:610-612 records only the finish reason and usage.
  - #79's `ResearchAssistAttemptRecordSchema` at head d364b46 has no such field.
  - scripts/registry-row.py:504-508 reports only the configured model.
  - So a provider-side model change between E3 and E4 would go unseen.
  - Item 11's gate-signal design also records, per run and touchpoint, a would-fire flag on arms A and B. The flag is derived from the per-attempt plan records and the synthesis invalid and truncated counts, and keeps denied or stopped calls apart from rejected replies.
- (e) New backlog item 17: an approved-egress manifest, kept under src/, checked wherever a cloud destination is built, and pairing each key variable with its host.
  - Its seed rows come only from recorded approvals: BL-20261030-0745-claude-cloud-adapter-approved for api.anthropic.com; PLAN §4(b) for gpt-6-sol at api.openai.com; decision 5's judges as documentation-only rows; and cloudflare-dns.com. Any row without an approving entry goes to the owner.
  - Today `buildCloudArm` pins only the Anthropic URL and accepts any HTTPS host for the two OpenAI request shapes, key included (scripts/private-agent-local-screen.ts:282-288). The consultant accepts any HTTPS endpoint (src/main/general-tasks/consultant-config.ts:51-59). So PLAN.md:932-936's approval rule for new egress destinations has no code gate.
  - It lands before E3's first freeze if decision 6 names gpt-6-sol, and otherwise before item 12's search destination.
- (f) Proposals for the E3 card (issue #63):
  - A section headed "descriptive, not decision inputs". It holds an escalation-help table: whether the touchpoint fired on B or would have fired on A, beside the blind verdict, with candidate missed escalations labelled as an upper bound.
  - In the same section, the probability under uniform priors that one route's accept rate exceeds another's. One-accept gaps come to about 0.70-0.77 and two-accept gaps to 0.86-0.90.
  - The runs whose single flip would change eligibility, D's single run included.
  - As owner options: a pre-registered tie-break for routes that trade, using V per accepted task-run, λ per disclosed KB (which may be infinite) and τ per P50 minute; and a conditional second D repeat on the deciding tasks, inside the approved cap. The tie-break never changes the rule text or the caps.
- (g) Decision 6 (issue #59): a zero-fee addendum comparing the two providers' API data retention, abuse-monitoring retention and zero-retention eligibility, beside the existing price comparison.
- (h) Decision 5's open part (issue #61, question 3): the proposed metering for E4's judges is a loopback gateway built on SOAR's store and pricing code, with one job per report.
  - It holds the JAO and JAT keys.
  - It reserves every HTTP attempt, SDK retries included, at the judge's own token limit.
  - It refuses past the USD 6 sub-cap, settles from usage, and never replays a reply while scoring.
  - Weigh it against per-key provider budgets plus reconciliation.
  - Both pinned judges read `OPENAI_BASE_URL`, so neither needs a patch.

(4) Considered and deferred: a blinded pairwise preference beside accept or reject for E2's writers, after Workshop's Arena; and host-rendered PDF previews for deck and site jobs, only if E5 shows rejections driven by layout. PLAN.md's conditional `render_and_view` is unchanged. Rejected:
- a one-command, resumable E0 runner, which would break one card per probe run;
- ARC as a local shadow router now;
- prompt-feature or prefer-local escalation;
- per-turn model switching;
- exploration on owner jobs;
- Rayline-style headline arithmetic that shows local work as 0% of cost;
- code dependencies on Raydock, `vllm-arc` or the semantic-router fork.

Changes:
- docs/BUILD_LOG.md: this entry.
- docs/HANDOFF.md: "Start here" §5 gains the dated adjustments note.
- docs/ROUTING_POLICY_RESEARCH.md: a dated addendum.

The research document is on the unmerged branch `research/rayline`. No code, test, schema or configuration changed.

Evidence:
- On 2026-11-13 the agents read Rayline's site, docs, report PDF (as extracted text), model card and repositories, all read-only. This session then read the 23-page report itself, text and figures, from the copy the owner supplied. It checked the figures this entry relies on (Figures 8, 9, 11 and 13) and §2.3's evaluated configuration. They checked each kept idea against this repository at 2982ca7. The research document carries the file and line citations.
- This session re-checked every SOAR fact in decision 3 at `main` 9d10b9a, after merge train 1:
  - the doctor's /models read and `ready` (setup-general.ts:81-83, :114);
  - the `model_finished` record (runner.ts:610-612) against model.ts:406;
  - registry-row.py:504-508;
  - the cloud-arm host check (private-agent-local-screen.ts:282-288) and the consultant's endpoint check (consultant-config.ts:51-59);
  - #79's assist record schema, at head d364b46.
- `pnpm --silent validate:build-log -- --base-ref origin/main` and `pnpm validate:readiness` pass with this entry appended. `pnpm typecheck` passes; the change touches documentation only.

Failures or blockers:
- Rayline's pricing tables did not render. Its solutions pages render only in the browser, so their text was read from the site's script bundle.
- No independent replication of any Rayline figure was found. The only outside coverage was one aggregator funding story and a Show HN thread of 11 points.
- Every docs.rayline.ai page tells AI agents to fetch an llms.txt index first; the agents did not act on it.
- Other open pull requests carry entries dated around this one: #79, #80, #82, #84 and #75 (2026-11-10), and #87, #88 and #89 (2026-11-13). Under the owner's rule of 2026-11-13 (BL-20261113-0758-owner-decision-restamp-unmerged-entries, on #87), whichever branch merges later re-stamps its earlier-dated entries after `main`'s tail and adds a Correction recording the original IDs. No fixed merge order is needed.

Limitations and non-claims:
- This is research and planning only. Nothing is implemented, verified or released.
- Rayline's figures are its own. The run's reconstruction of them (about 25.8% cost per benchmark) is arithmetic on Rayline's tables, not a measurement.
- The 2026 literature cited is preprints the run read once.
- The value of each adjustment is unmeasured. For example, whether the doctor check, the sequence condition or the judge cells change any decision depends on E0.
- Adjustments (a), (b), (d) and (e) authorize scoped zero-fee work. (c), (f), (g) and (h) are proposals that bind nothing until the owner records them on their tickets.

Paid exposure: None. Zero SOAR model requests, zero Rayline requests and zero envelope spend. Every cap is unchanged.

Next gate:
- Review, then merge. If `main`'s tail is later than this entry by then, re-stamp it under BL-20261113-0758-owner-decision-restamp-unmerged-entries.
- (a) and (b) can be built before E0 at zero fee.
- (d) goes to the 10.b and item 11 lanes.
- (e) starts from `main` after this entry merges.
- The owner records (c), (f), (g) and (h) on #47, #63, #59 and #61.

References:
- docs/PROJECT_REVIEW_2026-11-05.md: §5.2 (principles 3 and 4, the S10 row), §5.6 (the E0, E3 and E4 rows), §5.7 (items 10, 11 and 16) and §5.8.
- docs/PLAN.md:135, :932-936 and :1010-1011; docs/ROUTING_POLICY.md:95; docs/ROUTING_POLICY_RESEARCH.md.
- BL-20261107-0650-owner-decisions-review-items-2-5; BL-20261030-0745-claude-cloud-adapter-approved; BL-20261108-0911-probe-extensions-implemented; BL-20261110-1506-merge-train-1-integration.
- Issues #46, #47, #59, #61 and #63.
- Branch `research/rayline`: docs/RAYLINE_RESEARCH.md.
