# Private work design: strict privacy, admin assistant, research and document review

Status: **`Proposed` (2026-09-28 UTC / 2026-09-29 local).** This document is the
design companion to the approved [plan](../PLAN.md). It responds to the owner's
answers of 2026-09-29, recorded in BL-20260928-1745-owner-answers-plan-approved. It
grants no runtime, private-data, connector or spending authority. Each gate named
here still needs its own recorded approval.

The owner's rule, in their words: *"I don't want any of my personal data leak to
the cloud, and for more strict data protection, think of the need from lawyers,
doctors and scientific researchers."*

Sources were checked on 2026-09-29 by four research lanes and a fact-checker. The
fact-checker confirmed 45 of 72 claims outright and corrected the rest before use.
Items marked *snippet-only* could not be fetched in full.

## 1. What the rule means in practice

"No personal data to the cloud" covers every place bytes can go, not only cloud
AI models:

- cloud model and consultation providers;
- web search engines and fetched URLs (a query can reveal a client's matter or a
  patient's condition without naming anyone);
- DNS and hostnames;
- development agents and reviewers (including the one writing this plan);
- telemetry and crash reporters;
- iCloud Drive (under Standard Data Protection Apple holds the keys);
- any new third party.

Two cases need to be stated precisely:

- **The owner's mail and calendar provider already holds that mail.** SOAR adds
  no new recipient when it reads from that provider. SOAR adds a new disclosure
  when it writes back anything derived from other sources.
- **Pseudonymised or placeholder packets are still personal data.** GDPR Art 4(5)
  and PIPL Art 73 both say so, and redaction is imperfect: the local privacy filter
  missed 5 of 12 mandatory canaries. So **cloud help is off for every labelled
  context**. There is no placeholder-packet exception unless the owner later opts
  in explicitly, per task. There is never an exception for regime-tagged data
  (§2).

None of the professional rules reviewed *require* local inference. They are ABA
Model Rule 1.6(c) with Formal Opinion 512, Law Society of Ontario guidance, the
CCBE guide, HIPAA 45 CFR 164.312 and 164.514, PHIPA, PIPEDA, GDPR Arts 9 and 32,
PIPL Arts 28-32, the Common Rule, NIH NOT-OD-24-157 and NOT-OD-25-081, and NIST SP
800-171r3. They converge on these controls:

- no third-party AI without safeguards or informed consent;
- encryption;
- access control;
- audit records;
- minimization;
- deletion;
- incident handling.

The CCBE guide names running AI locally as a safeguard. NIH says prompting public
generative-AI tools with controlled-access data violates the Data Use
Certification. Local inference is SOAR's advantage, but only with those controls
around it.

## 2. Strict privacy profile

These are the requirements, classified by when they are needed:

- *now*: cheap work that shapes contracts and can be tested on synthetic data;
- *before real private data*: the Tier-O gate in the plan;
- *later*: deployment for a firm, clinic or lab.

| # | Requirement | When |
| --- | --- | --- |
| P1 | **Data labels as a persisted contract.** A lattice `public < personal < confidential_professional`, with optional regime tags (`legal_privileged`, `health_phi`, `research_human_subjects`, `controlled_access_genomic`, `export_controlled_or_unpublished_ip`). Imports default to `confidential_professional`, and unknown provenance is never public. Everything derived (summaries, compressed observations, checkpoints, plans, filenames, exports) carries the join of its context's labels. Only the owner can lower a label, through a logged action. This replaces `publicOrSynthetic: literal(true)` ([general-task-contracts.ts:46](../../src/shared/general-task-contracts.ts)) and `SourceSchema.classification` ([contracts.ts](../../src/main/private-agent/contracts.ts)). | now |
| P2 | **Label-aware default-deny egress at the broker.** A context labelled `personal` or above may reach only the admitted local inference destination. Cloud, consultation, search, fetch, job-initiated DNS and connector writes are refused and logged. Local failure never falls back to cloud; the job pauses and states the gap. Canary tests prove zero bytes leave. | now |
| P3 | **Search and fetch are disclosures.** Labelled jobs are closed-corpus: search, fetch and consultation tools are *not offered* to the model at all. Public research runs in a separate public worker that sees only a public brief the owner wrote. A later "approved-query" mode releases one exact query at a time after owner preview, and never for regime-tagged contexts. | now |
| P4 | **Contain prompt injection structurally.** Documents, pages, emails and invites are untrusted data. P2 removes every channel out of labelled contexts. Side-effect actions (send, accept, publish, delete) are never model-callable; the model produces drafts that the owner executes. Hidden content is surfaced: tracked changes, comments, white or zero-size text, hidden slides, metadata. | now |
| P5 | **Keep development tooling away from private data.** No development agent, reviewer, CI job or cloud assistant reads Tier-O inputs, outputs, traces, databases or screenshots. Tier-O paths are denied in agent permission settings, the registry is hash-only, and debugging uses hashes, counts and the owner's own description. | now |
| P6 | **Isolation between matters, patients and studies.** No memory or retrieval across jobs unless the owner links them, and a link inherits both label sets. | now |
| P7 | **Honest mode names.** "Local only" means no web and no cloud. "Local + public web" means queries and URLs leave. "Cloud help" means only packets the owner approves leave. No compliance words anywhere (§6). | now |
| P8 | **Tamper-evident, content-free audit log.** Add a `prev_sha256` hash chain to events and dispatch receipts. Record labelled reads (label, content hash, keyed HMAC of the path), every dispatch (local included), refusals, approvals, declassifications, exports and deletions. Export the head hash at job end, ship a verifier, and generate a per-job disclosure report. | now (contract), before real data (verified) |
| P9 | **Mac at rest.** FileVault on. All SOAR state, `.soar`, exports, the Docker VM disk and `.env.local` stay off iCloud Drive and Desktop & Documents sync. Secrets go in the Keychain. Time Machine backups are encrypted or exclude SOAR paths. | before real data |
| P10 | **Device at rest and in memory.** The device acts as a stateless inference box: no request or output logs, no prompt or KV offload to disk, no crash dumps (Apport/whoopsie off). Swap is off or encrypted. Tier-O data lives only on an encrypted volume, or not on the box at all. | before real data |
| P11 | **Encrypted, authenticated transport.** SSH local forward (keys only, pinned host key) or WireGuard, never plain LAN HTTP. vLLM gets `--api-key` (defense in depth only; it does not cover control endpoints), a restricted `--allowed-origins`, and an allowlisting proxy for `/v1/chat/completions` and `/v1/models`. On an RMinte RM-01 the inference module has no SSH, so the path runs through the application module (§5). | before real data |
| P12 | **No telemetry, proven by packet capture.** Device: `VLLM_NO_USAGE_STATS=1` or `DO_NOT_TRACK=1` (vLLM usage stats are on by default), `HF_HUB_OFFLINE=1`, `HF_HUB_DISABLE_TELEMETRY=1`, and no `--enable-log-requests` or `--enable-log-outputs`. Mac: Docker Desktop "Send usage statistics" off (it defaults to on and covers crash reports); Electron crash reporter unused. Then run a canary job with nftables default-deny output on the box and a capture on its uplink. Every connection must reconcile to the ledger. | before real data |
| P13 | **Accounts.** No vendor-default passwords (the public RM-01 guide documents one); SSH key-only; `PermitRootLogin no`; unused services off. Later: in-app re-authentication (Touch ID) to open Tier-O jobs. | before real data |
| P14 | **Retention and deletion with a residual report.** Each job has a retention setting. Deletion removes DB rows (then VACUUM), checkpoints, workspaces, containers and caches, keeping a hash-only tombstone. It reports what SOAR cannot delete: APFS and Time Machine snapshots, SSD remapped blocks, and anything already exported or sent. | before real data |
| P15 | **Incident switch.** The broker revokes every destination and stops sandboxes. The ledger produces a disclosure report (bytes, recipient, time, labels). A `Failed` entry is written and re-approval is required. SOAR supplies the facts; notification duties belong to the professional. | before real data |
| P16 | **Serving identity.** Record weight hashes, vLLM version and launch flags (the box checklist); never `trust_remote_code` from unvetted repos; bind dispatches to the recorded identity. | before real data |
| P17 | **Deployment pack for a firm, clinic or lab.** BAA/DPA/DPIA templates, PIPL assessment, an NIH/NIST SP 800-171 attestation path, an IRB data-security plan, multi-user access control, MFA and emergency access. | later |

## 3. Admin assistant (email replies, calendar management)

These are the owner's most injection-exposed jobs. Every incoming message or
invite is text written by someone else that the agent will read. Documented
incidents show the pattern:

- **SafeBreach "Invitation Is All You Need"** hijacked Gemini through calendar
  invites and email subjects; Google mitigated it in June 2025.
- **Miggo (reported January 2026):** a dormant payload in an invite led Gemini to
  create a new event exposing private meeting summaries.
- **EchoLeak (CVE-2025-32711):** zero-click exfiltration from M365 Copilot.
- **ShadowLeak:** ChatGPT Deep Research exfiltrated Gmail data.
- **postmark-mcp 1.0.16:** a malicious MCP server that BCC'd every sent email.

Each attack needed three things together: private data, untrusted content and an
outward channel. SOAR's broker and `--network none` sandbox remove the outward
channel, and this design must keep it removed.

**Rules, from the start:**

- **No outward actions.** The admin lane has no send path at all: no SMTP, no
  Graph `Mail.Send`, no Gmail send endpoints. The broker denies them, and a CI
  test asserts that a fixture SMTP server receives nothing.
- **Recipients come from code.** They are computed from Reply-To/From/To/Cc headers
  plus the owner's instruction, never from model output. Any address the model adds
  is flagged along with where it came from.
- **Calendar logic is deterministic code.** Time zones, DST, free/busy, recurrence
  expansion (RRULE/EXDATE/RECURRENCE-ID) and conflicts are computed by code. The
  model only extracts constraints into a validated JSON schema.
- **Nothing is fetched.** No web, links, remote images or auto-unsubscribe. The
  in-app viewer blocks remote content and shows the real URLs.
- **Taint flags.** The owner is warned about text from other threads,
  out-of-thread recipients, and new URLs, payment details or amounts that the owner
  did not write.
- **Holds, not RSVPs.** Proposed events are attendee-free holds on a dedicated
  calendar. SOAR never changes PARTSTAT: RFC 6638 makes the server notify the
  organizer, and Graph `tentativelyAccept` sends a response by default.
- **A fixed pipeline, not the open agent loop.** Deterministic ingest (mbox,
  `.eml`, `.ics`) goes into an index in the sandbox. Quarantined per-thread local
  calls then triage, extract and draft. Deterministic checks follow, and finally an
  owner review queue.

**Stages, most private first:**

| Stage | What it does | Gate to enter |
| --- | --- | --- |
| 1 | Draft-only on **file exports** (Google Takeout mbox/`.ics`, Apple Mail or Outlook export). Output is `.eml` drafts and `.ics` holds that the owner opens and sends from their own client. Synthetic mailboxes first. | Synthetic: zero canary leaks, zero injected recipients, recipient exact-match ≥ 98%, slot checker 100%. Real mail: Tier O verified plus an `Approved` entry. |
| 1b | Read-only sync on the host: `mbsync` (IMAP to Maildir) and `vdirsyncer` (CalDAV to `.ics`), or official read-only APIs (Gmail `gmail.readonly`, Graph `Mail.Read` and `Calendars.Read`). Tokens live only in the Keychain, held by the broker. | Owner approves each provider as a new broker destination. |
| 2 | The broker (not the model) saves drafts to the provider's Drafts folder and creates attendee-free holds (`sendUpdates=none`). **Off by default.** Every write is label-checked and **owner-approved on its exact bytes**, because a draft drawing on other threads or files is a new disclosure to the provider. Gmail `gmail.compose` also permits sending; the broker's endpoint allowlist must block send. | ≥ 70% of Stage-1 drafts accepted with ≤ 2 minutes of edits over 2 weeks, plus owner approval. |
| 3 | Owner-approved send or accept, per action, bound to the exact MIME or iTIP bytes, strictly at most once, with a cancel window, a daily cap and a Sent-folder check. **Never autonomous in the MVP.** | 4 weeks of Stage 2 with no wrong-recipient or wrong-hold incident, plus an owner decision naming which message classes may become sendable. |

**Reuse.**

- Python stdlib `email` and `mailbox`, and `icalendar`.
- `mbsync` and `vdirsyncer`.
- AgentDojo's workspace injection cases, which need an adapter for local vLLM.
- Design patterns from arXiv 2506.08837 (Dual LLM, Plan-then-Execute).
- Third-party email and calendar MCP servers only as references or test oracles,
  never in the trusted path unless pinned, read-only and behind the broker.

**Cloud in this lane.** `gpt-6-sol` may generate synthetic personas and mailboxes
with **no seed from the owner**: no real contacts, style samples or calendar
patterns. It may also act as a reference arm on synthetic mail only, up to
USD 20. Voice examples from the owner's own Sent mail stay local-only.

## 4. Research and document review

The main reliability risk is unsupported citations, and hosted systems still show
it:

- The best deep-research agents leave about 6-22% of citations unsupported
  (DeepResearch Bench FACT).
- Audits find citation accuracy of about 40-80%.
- Legal RAG tools hallucinate in about 17-33% of answers.

SOAR's reliability must therefore come from deterministic host checks, not from
the model judging itself.

**Research (closed-corpus in the MVP):**

- **Claims ledger.** The report comes with a claims ledger. Each entry records
  claim id, sentence, source id, a verbatim quote of 300 characters or less, and
  the claimed locator. Every factual sentence cites a claim.
- **Host quote check.** After normalization, the host verifies every quote against
  the retained source bytes and computes the page, paragraph or clause locator
  itself. The agent can call this check to repair; at finish it is a critical
  check with **zero fabricated quotes**.
- **Local entailment pass.** A fresh-context, low-effort local call judges each
  claim against its quote plus about 1-2 KB of surrounding source. Unsupported
  claims are shown as "not verified against source", never dropped silently. The
  support rate is a registry metric.
- **Required sections.** Reports must include "conflicting evidence" and
  "unanswered questions" sections.
- **Web search later, and only in public jobs.** Options are Brave Search API
  (USD 5 per 1,000 requests; queries kept up to 90 days; zero retention only on
  enterprise plans) or self-hosted SearXNG (it strips identity but upstream engines
  still see the query). Because of the DNS rule, SOAR's current public DNS through a
  Cloudflare resolver must also be counted as a disclosure.

**Document review and amend:**

- **Model output is an edit plan, not markup.** The model emits a JSON edit plan
  (anchor quote, action, new text, rationale, severity) and never writes revision
  XML.
- **A deterministic script applies the plan** in the sandbox, producing native
  tracked changes (`w:ins`/`w:del`) attributed to "SOAR draft", comments with
  rationale, an XLSX issues list and a clean amended copy.
- **Fidelity checks prove the result:**
  - reject-all text equals the original;
  - accept-all text equals the plan applied to the original;
  - non-body OOXML parts are unchanged;
  - every revision maps to an issue;
  - revision IDs are unique;
  - both files render to PDF.
- **PDFs** get annotations (pypdf) plus the issues list; their text is not edited
  in place.
- **Clause numbers** come from rendered numbering, never from paragraph text.
- **Export hygiene report** before anything leaves the app: author metadata,
  comment authors, remaining revisions, hidden text.
- **Tooling.** `docx-revisions` (pure Python, MIT) is the base, with
  `python-redlines` (MIT, Docxodus engine, linux-arm64 wheels claimed but untested)
  as an option. This is **one image rebuild**, made after a `docker save` of the
  qualified image and followed by recorded re-qualification.

**Private jobs:** closed-corpus only. Search, fetch and consultation tools are not
offered. Professional presets (privileged or client-confidential, PHI or patient,
unpublished manuscript or grant, unpublished research data) map to Tier O and carry
their regime tags.

## 5. The device

The owner reports an NVIDIA Jetson module with shell access. The served alias
"RM-01 VLM" matches RMinte's RM-01 appliance. That appliance has:

- an x86 application module, which has SSH and a publicly documented default
  password;
- a Jetson inference module with no SSH, serving vLLM on an internal link;
- an ESP32 management module (TianshanOS) with WiFi, OTA and SSH remote execution.

RMinte also sells 32 and 64 GB configurations. The whole appliance is rated
100 W, below a Thor T5000's default mode. So the exact module (Thor versus Orin,
memory size) is **unconfirmed**.

**Throughput must be measured per workload.** On the Thor/DGX Spark bandwidth class
(273 GB/s), dense Qwen3.8-27B FP8 is measured at about 8 tokens/s on plain prose,
about 18 with MTP and about 32 with a DFlash2 drafter. The client-side 42-44
tokens/s SOAR observed therefore implies one of:

- speculative decoding on code-like text;
- a 27B NVFP4 build with a drafter (42.3 tokens/s on Thor, coding);
- a different model.

*Measured 2026-09-28* ([serving card](../experiments/serving-card-2026-09-28.md)):

- prose without thinking: about 35 tokens/s;
- code: about 58 tokens/s;
- thinking text: 56-67 tokens/s;
- prefill of a fresh 47K-token prompt: about 1,790 tokens/s, with 44.8K tokens
  reused from cache on a repeat.

Prose-heavy work is therefore about 1.2-1.7× slower than code, not 2-5×.

**Candidates if the fair test is throughput-limited (plan rule R2):**

- MTP or DFlash2 on the 27B;
- 27B NVFP4;
- Qwen3.6-35B-A3B (about 100-139 tokens/s with DFlash on Thor, community-reported);
- Qwen3.8-Flash-Next as a community NVFP4/FP8 hybrid on a 128 GB Thor (46.7
  tokens/s reported). This **corrects** the review's "cannot run": it can on
  128 GB, but it is not vendor-supported and the device's memory is unconfirmed.

**Always-on host (later).** The aarch64 sandbox image could run on the Jetson, but
unified memory means vLLM start-up can starve the OS. Reserve 16-24 GiB, set cgroup
caps on the sandbox, give vLLM a negative OOM score, and put the box on a UPS with a
second path for power-cycling. On an RM-01 the runner would live on the x86
application module, which needs an amd64 image and re-qualification.

**Remote access while travelling:**

- **Preferred:** plain WireGuard or self-hosted Headscale.
- **Tailscale:** discloses device names, IPs and connection times to its
  coordination server, and the standard macOS app cannot turn off log upload. The
  owner can accept that explicitly as metadata disclosure.
- **In all cases:** no port-forwarding and no public exposure.

**Box checklist.** Run [`scripts/box-checklist.py`](../../scripts/box-checklist.py)
on the machine you have a shell on, with `sudo python3 box-checklist.py` for full
results.

- **What it prints:** only an approved list of facts: identity and versions, the
  inference server's flags as names and on/off values, the model's
  `config.json` summary and hash, listening ports and connection counts by address
  class, watched services, SSH, disk-encryption and firewall settings.
- **What it never prints:** IPs, hostnames, usernames, keys, or raw command lines.
- **Testing so far:** its parser self-test passes and it degrades cleanly on macOS.
  It has not yet been run on Linux.

## 6. What SOAR must not claim

SOAR must not claim any of the following:

- **Compliance or suitability:**
  - "HIPAA/PHIPA/GDPR/PIPL/NIST compliant";
  - "meets ABA 512";
  - "preserves privilege";
  - "IRB-approved";
  - suitability for NIH controlled-access or export-controlled data.
- **De-identification:** calling placeholder packets "de-identified" or
  "anonymised".
- **Local-only claims that aren't yet true:**
  - "Nothing leaves your device" while web, connectors or cloud help are enabled,
    or before the packet-capture test passes.
  - An encrypted Mac-to-device link before the tunnel is verified.
- **Absolutes:**
  - a "tamper-proof" log (at best tamper-evident, and only when anchored);
  - "secure deletion" of SSD data, snapshots or anything already sent;
  - immunity to prompt injection;
  - that the privacy filter catches all personal data.
- **Unmeasured facts:**
  - that the device runs Qwen3.8-27B FP8 before probe P1;
  - model quality, languages or throughput before measurement.
- **Other parties' assurances:**
  - vendor statements (RMinte's "no external servers", provider zero-retention
    terms) as proof that nothing was disclosed.

## 7. Owner questions this design raises

These are collected in the [plan's owner decisions](../PLAN.md#5-owner-decisions)
as D13-D19:

- mail and calendar accounts and clients;
- jurisdictions and third-party data;
- whether "never" is absolute for cloud;
- default retention;
- the remote-access transport;
- the Mac's encryption and sync state;
- whether provider-side AI features (Gemini in Gmail, Copilot in Outlook) count as
  a leak the owner wants turned off. SOAR cannot control those.
