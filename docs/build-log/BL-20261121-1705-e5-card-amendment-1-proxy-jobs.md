### BL-20261121-1705-e5-card-amendment-1-proxy-jobs -- 2026-11-21 -- E5's Amendment 1 sets the rules for proxy jobs: Codex agents bring public-community needs to E5's build as real tasks, judge them as their personas, with a blind sample as the check, and count toward the MVP bar

Status: `Approved`

Scope or hypothesis: The owner let agents that mimic real users proxy E5's real jobs (BL-20261121-0611-owner-e5-proxy-jobs-and-13b-answers, decision 1) and set the verdict, the needs, the model and the MVP count (BL-20261121-1701-owner-e5-proxy-job-choices). This amendment sets the rules those agents follow. `Approved` covers the rules as set under those decisions; the owner chose that Codex, not this session's lanes, builds the tooling and does the work. No proxy job has run, and none counts before the rehearsal of point 10.

Decisions:
1. A proxy job is a real task a Codex agent brings to E5's build (`owner-v0.2.1`) for a persona grounded in a public community post, in one of E5's three families, on public or synthetic inputs only. The source log keeps the URL, dates, a content hash and a paraphrase, never the poster's details or the post's text.
2. One job at a time on an idle endpoint, in the build's own window and its own user-data folder, never overlapping the owner's jobs, after the daily doctor.
3. The agent that brought the task judges it by E5's rule; its self-judgement is disclosed. A random weekly sample goes to fresh blind graders, with one decoy; the second false accept or an accepted decoy pauses proxy counting until the owner decides.
4. Only public or synthetic text goes to Codex, behind a scan; a private-data hit voids the job, and the owner's data stops all proxy jobs.
5. For the MVP bar, a UTC week's first 8 jobs, owner's and proxies' pooled, are read (recommended); rows carry `verdictBy: proxy_agent`, a value registry-row.py lacks and whose persisted-contract change comes before the first row.

Changes: docs/experiments/e5-card-2026-11-17.md (Amendment 1, 112 lines); this file.

Evidence: The owner's decisions in the two entries above; E5's card; PLAN.md §1; registry-row.py's `--verdict-by` values; the E2 and E6 grading briefs.

Failures or blockers: None. The tooling does not exist yet.

Limitations and non-claims: A proxy verdict is self-judged, not the owner's and not a correctness grade. Proxy jobs test acceptance, not the owner's need. Open for the owner: whether Codex use is metered; whether 13b's waiver opens Tier O for the bar; whether a week can pass on proxy jobs alone; whether proxy jobs enter E5's own 3-of-5 reading (recommended: a separate reading).

Paid exposure: None here. Codex runs on the owner's plan; metered use would sit inside the USD 300 envelope and USD 8 a task.

Next gate: Codex builds the tooling and `proxy_agent`; one synthetic rehearsal; then the first proxy job.

References: BL-20261121-0611-owner-e5-proxy-jobs-and-13b-answers; BL-20261121-1701-owner-e5-proxy-job-choices; BL-20261117-0940-owner-direction-decisions-delegated; docs/experiments/e5-card-2026-11-17.md; docs/PLAN.md §1; docs/experiments/e2-grading-brief.md.
