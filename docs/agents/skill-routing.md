# Skill routing

Some skills run only when the user types their slash command. Your job is to
**suggest** the matching command at the moment it fits, in one line with the
reason ("This plan looks settled; run `/to-spec` to publish it as an issue."),
then continue with what the user asked. One suggestion per situation; if the
user passes on it, carry on without it.

## When to suggest which command

| Situation you notice | Suggest |
| --- | --- |
| A plan or design is still forming, with open terms or decisions | `/grill-with-docs` |
| A plan is settled in conversation and not yet written down | `/to-spec` |
| A spec or plan exists and needs splitting into buildable tickets | `/to-tickets` |
| The work spans more than one agent session | `/wayfinder` |
| Open issues lack triage labels, or an issue needs an agent-ready brief | `/triage` |
| A ticket is `ready-for-agent` and the user wants it built | `/implement` (one ticket) or `/implement-spec` (whole spec) |
| The user asks where the codebase's design could deepen | `/improve-codebase-architecture` |
| A long session is ending and another agent will pick it up | `/handoff` |
| A session just finished and the environment showed friction | `/retro` |
| A decision needs someone other than the user | `/to-questionnaire` |
| No row fits, but a skill probably does | `/ask-matt` |

## SOAR gates

The commands above publish to GitHub or start implementation runs. They sit
inside this repo's rules in `AGENTS.md`:

- Suggest `/implement` or `/implement-spec` only for work whose plan approval
  gate is durably recorded; otherwise suggest recording the approval first.
- A published spec or ticket is `Proposed`, never `Approved`.
- When a skill's output is a crucial change, the `docs/BUILD_LOG.md` entry is
  still part of done.
