# Configure one general-task consultation

Consultation is optional. Local only remains the default. The desktop has verified
its approval and restart mechanics with scripted responses; that does not verify
your provider, credentials, prices or the quality of its advice. Use only public
or synthetic task material in this pilot.

The consultant profile comes only from the environment of the process launching
SOAR. It is separate from the local coordinator, coding-pilot credentials and the
legacy cloud settings. Entries placed in `.env`, `.env.local`, or an old prepared
Terminal do not automatically configure it. There is no consultant settings or
credential-import screen in this milestone.

## Set the explicit session profile

In a dedicated shell, provide the following exact names. Use the provider and
current rates approved for your trial; this guide deliberately supplies no live
endpoint, credential or price. Keep credentials out of shell history, command
arguments, files, screenshots and chat. SOAR does not load a key from Keychain or
reuse a legacy credential for this profile.

| Environment field | Required value |
| --- | --- |
| `SOAR_GENERAL_CONSULTANT_ENDPOINT` | Exact HTTPS chat-completions URL, including its resource path. No credentials, query or fragment. A base URL or models URL is not sufficient. |
| `SOAR_GENERAL_CONSULTANT_MODEL` | Exact model identifier. The provider response must echo this identifier. |
| `SOAR_GENERAL_CONSULTANT_ACCOUNT_ID` | Explicit account identifier used to bind approval. |
| `SOAR_GENERAL_CONSULTANT_CREDENTIAL_VERSION` | Nonnegative integer version for the selected session credential. |
| `SOAR_GENERAL_CONSULTANT_API_KEY` | Session-only credential, supplied securely without displaying it. |
| `SOAR_GENERAL_CONSULTANT_MAX_OUTPUT_TOKENS` | Integer from 128 to 4096. |
| `SOAR_GENERAL_CONSULTANT_INPUT_MICROUSD_PER_MILLION` | Approved nonnegative integer input price in micro-USD per million tokens. |
| `SOAR_GENERAL_CONSULTANT_OUTPUT_MICROUSD_PER_MILLION` | Approved nonnegative integer output price in micro-USD per million tokens. |
| `SOAR_GENERAL_CONSULTANT_TIMEOUT_MS` | Integer from 1 to 300000 milliseconds, still bounded by the original task deadline. |
| `SOAR_GENERAL_CONSULTANT_MAX_FEE_MICROUSD` | Explicit maximum charge for the one consultation, in integer micro-USD. |

`SOAR_GENERAL_CONSULTANT_CACHED_INPUT_MICROUSD_PER_MILLION` is optional. If set,
it must be a nonnegative integer no greater than the input price. Otherwise cached
tokens are charged at the input rate. One USD is 1,000,000 micro-USD. Do not enter
decimal dollars, exponent notation, or an unverified zero price. The exact packet
reservation is computed later; a profile passing this check does not guarantee
that every proposed packet fits its charge cap.

Do not set `SOAR_GENERAL_CONSULTANT_LOOPBACK_FIXTURE` for a real provider. It is
restricted to explicitly enabled tests on literal loopback addresses.

`SOAR_GENERAL_CONSULTANT_SERVICE_TIER` is optional and accepts only `default`.
When configured, the request explicitly selects that service tier and the response
must confirm it before fee settlement. Configure it when the approved provider
trial binds standard-tier pricing. Leaving it unset preserves the previous request
format; it does not establish which billing tier the provider will use.

## Check locally, then launch from that same shell

After installing the project's existing dependencies, run from the repository:

```sh
pnpm check:general-consultant
```

The command prints only `ready`, `missing` or `invalid`, fixed explanatory text,
and missing/invalid environment **field names**. It prints no field values,
endpoint, model, account, profile hash or key-derived digest. It does not read
environment files, contact a provider, inspect funds, launch SOAR, or approve a
request. Exit code 0 means the local syntax and limits pass; exit code 2 means
configuration needs attention. Fix the listed field and check again.

Launch the normal development app from the same configured shell:

```sh
pnpm dev
```

The local coordinator must also be configured, and `SOAR_GENERAL_TASK_IMAGE_ID`
must select the already installed, qualified immutable Docker image. No image is
downloaded by general-task readiness. Avoid `pnpm dev:patch`: its cloud-only
coding launch disables the local coordinator required by this flow. Opening an
already running app does not import a different shell's environment. Quit the
previous process before relaunching with a changed profile. Keep the same profile
for a paused task; changing its credential, model, prices or limits invalidates
the saved execution identity rather than silently updating an approval.

## Review before sending

Create a new **General task**, choose **Ask before consulting**, and confirm that
the goal and inputs are public or synthetic. The local coordinator may request
one consultation; selecting the mode does not force it to do so. The app pauses
and releases its workspace before presenting a pending proposal.

Choose **Review consultation packet**. Check the complete packet, selected and
omitted paths, destination, account, credential version, model, prices, charge
ceiling and expiry. Approve only this exact proposal. Approval records permission;
the separate **Resume task** action performs the request. Decline or revoke
before dispatch to continue locally without it. Revocation after commitment
cannot recall disclosed bytes.

The original twenty-model-call, thirty-tool-action and fifteen-minute task limits
remain in force. Approval waiting consumes that original deadline, and one
consultant call consumes one model allowance. Failed or uncertain dispatches
cannot be replayed, and any recorded reservation remains. Advice is untrusted;
submission and independent artifact acceptance remain separate.

For a real trial, first confirm provider compatibility with the implemented
nonstreaming, tool-free chat-completions request (`max_tokens`) and response usage
fields. A provider requiring a different protocol is not made compatible by this
preflight. Follow the separately recorded trial authority and exact packet/fee
approval. The setup check itself authorizes no paid request.

## Prepared OpenAI diagnostic profile

The [one-task diagnostic proposal](plans/MVP_GENERAL_CONSULTATION_REAL_TRIAL_V1.md)
specifies a concrete profile, with a USD 0.10 maximum for one consultation.
This profile is proposed for the preserved synthetic website; it has not made a
real provider request. Its standard prices were checked against the official
sources linked in that proposal and must be refreshed if the trial is delayed.

In the dedicated zsh session, these assignments contain no credential:

```sh
export SOAR_GENERAL_CONSULTANT_ENDPOINT=https://api.openai.com/v1/chat/completions
export SOAR_GENERAL_CONSULTANT_MODEL=gpt-4.1-2025-04-14
export SOAR_GENERAL_CONSULTANT_SERVICE_TIER=default
export SOAR_GENERAL_CONSULTANT_ACCOUNT_ID=owner-openai-diagnostic
export SOAR_GENERAL_CONSULTANT_CREDENTIAL_VERSION=1
export SOAR_GENERAL_CONSULTANT_MAX_OUTPUT_TOKENS=2048
export SOAR_GENERAL_CONSULTANT_INPUT_MICROUSD_PER_MILLION=2000000
export SOAR_GENERAL_CONSULTANT_CACHED_INPUT_MICROUSD_PER_MILLION=500000
export SOAR_GENERAL_CONSULTANT_OUTPUT_MICROUSD_PER_MILLION=8000000
export SOAR_GENERAL_CONSULTANT_TIMEOUT_MS=120000
export SOAR_GENERAL_CONSULTANT_MAX_FEE_MICROUSD=100000
```

The account id above is an explicit local label for this one account, not an
assertion about a provider-side account identifier. Keep it and the selected
credential unchanged for the task. If that same prepared shell already contains
the previously authorized **OpenAI** session credential in `SOAR_PATCH_API_KEY`,
you can explicitly map it without displaying or saving it:

```sh
export SOAR_GENERAL_CONSULTANT_API_KEY="$SOAR_PATCH_API_KEY"
pnpm check:general-consultant
```

Otherwise enter the OpenAI key into the new variable with a hidden prompt:

```sh
read -s 'SOAR_GENERAL_CONSULTANT_API_KEY?OpenAI session key: '
export SOAR_GENERAL_CONSULTANT_API_KEY
pnpm check:general-consultant
```

Do not paste the key into chat. A ready result only verifies local configuration;
it does not start the staged trial or approve a consultant packet. Real execution
still follows the task admission and exact packet decision described in the
proposal. When the session is finished, unset `SOAR_GENERAL_CONSULTANT_API_KEY`.
