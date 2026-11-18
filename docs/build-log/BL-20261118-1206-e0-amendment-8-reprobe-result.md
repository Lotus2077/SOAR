### BL-20261118-1206-e0-amendment-8-reprobe-result -- 2026-11-18 -- E0 Amendment 8's re-probe at the new protocol hash: all twelve probes ran, and the revised card keeps the plan and extract rows, moves synthesis to 16,384 with thinking on both attempts, and sends synthesis no format

Status: `Verified`

Scope or hypothesis: The re-probe that Amendment 8 of E0's card registered (BL-20261118-1114-e0-card-amendment-8), at the protocol hash that #172 and #176 made, and the card its writer produced from it. `Verified` covers that the run followed the amendment's six steps and its conditions, and that the figures below are the probe's, the assessment's and the card's. The card is `proposed`: its adoption is the owner's (item 5).

Decisions:
1. **Amendment 5's check holds** (item 5). P11's sizes of 20,000, 60,000 and 120,000 prompt tokens are each `ok`, and `meanCompletionTokens` is above 0 in plan/on (2,922.7), extract/off (182.7) and synthesis/on (3,983.3). So the session asks the owner for the adoption commit, by name.
2. **Item 4's extra cell does not run.** Synthesis's flag has `thinkingOn` false, so with thinking on both attempts the stage sends synthesis no format, as in the addendum's confirmation cell. #181 is closed unmerged.
3. **One finding under item 4.** Synthesis gains a structured-output flag for thinking off only (`thinkingOff` true), from synthesis/off's 20 valid of 20. It sends nothing while synthesis thinks. Every other flag and every other role value equals the adopted card's.

Changes: docs/experiments/serving-card-2026-11-18.json and serving-card-2026-11-18.md, the writer's output as written (`proposed`; the JSON's sha256 0e87ba14ddfd20f6aca2cf4fc1e8b65748393d05e62aed47209ea0c13e445419); docs/experiments/registry.jsonl gains two rows in batch `e0-2026-11-18`, `e0-probe-2026-11-18-p1` and `e0-probe-2026-11-18-run1`; this file.

Evidence:
- **The checkout and the doctor.** The main checkout at b17a590, the merge of #180, with a clean tree and the source freeze `0b896d92…`. The doctor, read-only, reported `modelsOk`, `modelListed` and `completionOk`, and an identity equal to the adopted card's.
- **Step 1.** The export showed `outputTokens` plan 16384 and synthesis 16384, `protocolSha256` `4bb74c03239942d786ec9100d65b462ffe8378629c8ab3cd2eff32e26dd31636`, and request settings equal to the adopted card's P10 settings.
- **Step 2.** P1 alone, 11:27:13 UTC: one served model, whose alias, root, context and engine equal the adopted card's identity.
- **Step 3.** All twelve probes, 11:27:20 to 12:03:30 UTC (2,170 s), none failed, 171 calls, 0 running and 0 waiting before and after. probe.json showed `roles.output_tokens` plan 16384 and synthesis 16384, and `max_tokens` 16384 on both plan cells and both synthesis cells. The lanes were told of the window as step 2 started.
- **Step 4.** `schemasProtocolMatch` true under `4bb74c03…`, with no reply unassessed. Valid of 20: plan/on 20, plan/off 20, extract/on 19 (1 truncated), extract/off 20, synthesis/on 17 (3 truncated), synthesis/off 20.
- **Step 5.** The writer exited 0. The card: identity unchanged; the index, plan and extract rows and flags equal to the adopted card's; synthesis [16384, 16384] with thinking [model, model] and the flag above; `decision` proposed, `admission.basis` none, `localStreams` 1. P11's rates: prefill 3,439 to 3,563 tokens a second and decode 89 to 106 at the three sizes.
- **Step 6.** The default export again showed plan 8192 and synthesis 8192.
- **The adoption's values,** from this card with the writer's serialization, computed by the session and by lane S-pipe apart and equal: the adopted file, with this entry's ID as its `decision.entry` and `admission.basis` `serving_card` (only those two keys change), has sha256 9cd65c4e6f4872758098a6177bd66fd971e3fe0b4e81906b2542ee2c46b963ca (8,742 bytes). The repository's reader resolves it with basis `serving_card` and `localStreams` 1. The run hash under its roles with admission is 99bbc0e682ec0decdcffd9bb3c1ead52e6ba84f938e31587e5657b0f90a1d78d (lane S-pipe, `researchProtocolSha256` through the driver's own card path). It differs from the 8c8a56b9… the amendment expected, because synthesis's flag is no longer null.

Failures or blockers: None stopped the run.

Limitations and non-claims:
- **P10 measures the export's synthetic payloads,** not a task's. Synthesis/on's 3 truncations of 20 at 16,384 are on that payload; the confirmation cell on r3's packets kept all ten on attempt 1 (BL-20261118-0905-synthesis-evidence-id-tolerance). Neither is a rate.
- **Nothing is adopted here.** The run hash 99bbc0e6… binds only once the owner's adoption commit makes the file above.
- **One machine, one endpoint, one day.**

Paid exposure: None. 171 calls to the owned endpoint at USD 0, with the export's synthetic payloads and the probes' own prompts.

Next gate: The owner's adoption go (Amendment 8, item 5). Then the three r3 runs under the revised card (item 6).

References: docs/experiments/e0-card-2026-11-13.md (Amendments 5 and 8); docs/experiments/serving-card-2026-11-18.json; docs/experiments/serving-card-2026-11-17.json; docs/experiments/registry.jsonl; BL-20261118-1114-e0-card-amendment-8; BL-20261118-0905-synthesis-evidence-id-tolerance; BL-20261117-1356-e0-reprobe-result-plan-cap-16384; pull requests #180 and #181.
