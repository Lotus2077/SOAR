# Experiment launcher

`scripts/experiment-launcher.ts` (plan 11.5; design BL-20261114-1344-experiment-launcher-design) runs an experiment card's batch of
harness runs unattended:

- H4 loops through `scripts/phase4-loop.ts`;
- single runs through `scripts/private-agent-local-screen.ts`.

It starts them one at a time, in the card's order, only inside the card's windows, only on an idle endpoint and only under the batch's
fee cap. It records what it did as codes and counts. It is implemented and tested on fakes. It is not verified: the first E3 batch
under it is.

The launcher is outside the source freeze. Merging it changes neither the runtime hash nor the research protocol hash.

## Running a batch

From the repository root, on a clean checkout whose HEAD is on `origin/main`:

```bash
git fetch origin
pnpm launcher --queue .soar/experiments/e3/queue.json --state-directory .soar/experiments/e3/launcher
```

It refuses before it writes anything when:

- the tree is dirty, or the commit helper `localScreenGitState()` cannot say (`tree_dirty`, `commit_unknown`);
- HEAD is not an ancestor of the local `origin/main`, or git cannot say (`head_not_on_main`, `main_unknown`);
- the queue is invalid (`queue_invalid`);
- another launcher holds the state directory (`launcher_locked`).

After taking the state directory's lock, it also refuses when:

- the queue is not the one the state directory's ledger began with (`queue_changed`);
- a run from an earlier launcher is still running (`previous_run_running`);
- on macOS, `caffeinate` does not start (`inhibitor_failed`).

It prints one line, `{"code":…,"deferred":…,"finished":…,"pending":…,"spentMicrousd":…,"state":…}`. The exit code is 0 when the
queue is done, 2 when it stopped for another reason, and 1 on a refusal.

## The queue

The operator writes the queue from the card. Unknown keys are refused.

```json
{
  "version": 1,
  "batch": "e3-2026-11",
  "batchCapUsd": 20.4,
  "windows": [{ "start": "2026-11-20T01:00:00Z", "end": "2026-11-20T07:00:00Z" }],
  "runs": [
    { "id": "e3-b-01", "kind": "loop", "capUsd": 1.8,
      "argv": ["--select-and-repair", "--loop-directory", ".soar/experiments/e3/b-01", "...the driver's flags...", "--max-fee-usd", "0.6"] },
    { "id": "e3-d-01", "kind": "run", "capUsd": 0.6, "projectedSeconds": 2400,
      "argv": ["--output-directory", ".soar/experiments/e3/d-01", "...the driver's flags...", "--max-fee-usd", "0.6"] }
  ]
}
```

- **Windows.** Instants in UTC, in order, and not overlapping.
- **Runs.** They start in the listed order, which is the card's interleaved order.
- **Ids.** Lower-case identifiers. They are the only names of runs in the ledger.
- **`argv`.** The script's arguments. A loop's start with `--select-and-repair` and name `--loop-directory` once. A run's name
  `--output-directory` once. Directories are relative to the repository root, and two runs may not share one.
- **`capUsd`.** The most the run can spend. It must cover the arguments' own cap: at least `--max-fee-usd` for a run, and three times
  it for a loop, whose a, b and repair may each spend it. Part 3b's resumes are zero fee.
- **`projectedSeconds`** (optional). The card's projected run time. When it is given, the run starts only if that much time is left in
  the window. Without it there is no such check.

## The rules (HARN-26)

1. **One at a time.** One run at a time, in the queue's order.
2. **Idle and inside a window.** New starts happen only inside a window, after 3 observations 20 s apart in which
   `vllm:num_requests_running` and `vllm:num_requests_waiting` are both 0.
   - The launcher reads them from the `/metrics` route at the origin of the endpoint configured by `loadConfig`
     (`SOAR_VLLM_BASE_URL`, with the key when one is set).
   - It never prints or stores the address or the key.
   - An unreadable route or a missing metric is not idle. Nothing starts, and the ledger records `idle_check_unavailable`.
   - A busy or unreadable check is repeated a minute later.
3. **No cut at a window's end.** An admitted run is never cut at the end of its window.
4. **The batch cap.** The batch's spend so far plus the next run's cap must stay within `batchCapUsd`, or the launcher stops with
   `batch_cap_reached`.
   - The spend so far is the settled fees plus the pinned reservations of every run the batch made. It uses store.ts's exposure
     formula over every ledger in each run's directory, moved-aside runs included.
   - For a loop, the settled part is never less than `loop.json`'s `totals.feeMicrousd`.
   - For a loop that is invoked again, the next run's cap is what is left of the loop's cap.
   - A ledger that cannot be read stops the batch (`batch_cap_unreadable`).
5. **A dirty tree is refused.**
6. **No automatic paid re-run.** A single run is never started again. A loop is invoked again only as below.

## Loops that stop and resume (HARN-22)

When a loop's own `loop.json` ends with one of these, and with no stop and no final selection, the launcher invokes it again:

- `loop_stage_infra`;
- `loop_interrupted`;
- `loop_stage_cleanup_required`;
- `loop_stage_ledger_unreadable`.

The new invocation runs in a later window than the one the loop stopped in, after a fresh idle check, and at most 4 more times. Part
3b's own rules then resume the stopped stage once, at zero fee.

The launcher never invokes a loop again on:

- `loop_terminal`;
- `loop_locked`, which it reads from the loop's failure line, since a locked invocation leaves `loop.json` as it was;
- a terminal stop;
- a final selection;
- any other code.

After the fifth invocation, a loop that still stops is left for the operator. End it with
`node --import tsx scripts/phase4-loop.ts --close --loop-directory LOOP`.

## Stopping

- **The STOP file.** Create `STOP` in the state directory. Nothing new starts, and the run in progress finishes.
- **A signal.** Ctrl-C, SIGTERM or SIGHUP to the launcher is forwarded to the run's process group, and nothing new starts.
  - The run gets 120 s to stop; then its group is killed (SIGKILL).
  - A second signal kills it at once.
  - When no reap follows within 10 s, the launcher stops with `reap_unconfirmed`. Check the processes by hand before starting it again.

## Starting again

Run the same command with the same queue and state directory. The launcher replays its ledger:

- runs that finished are not started again;
- a deferred loop waits for its later window;
- if a run's admission has no recorded exit and its pid is alive, the launcher refuses (`previous_run_running`);
- if the pid is gone, it records `run_lost`. A lost single run is finished. A lost loop is invoked again like an interrupted one.

## The ledger

`launcher.jsonl` in the state directory is append-only, one canonical JSON object per line. Its events:

- `launcher_started`, with the launcher's sha256, the commit, the queue's sha256, the batch and its cap;
- `idle_check` and `quiescence`;
- `run_admitted`, `run_started` and `run_exited`. `run_exited` carries the exit code, the signal, the failure line's code, whether a
  signal was forwarded and, for a single run, its `jobId`;
- `signal_forwarded`, `kill_sent` and `reap_unconfirmed`;
- `run_deferred` and `run_finished`;
- `batch_cap_reached`, `window_too_short`, `refused` and `launcher_stopped`.

It holds codes and counts only. It never holds a path, the endpoint's address, a key, an error message or a child's output; each
run's own output goes to `runs/<id>.<attempt>.out` and `.err` in the state directory. The state directory stays under the ignored
`.soar/` and is never committed.

The registry does not read the ledger yet. Plan 11.4 wires `signal_forwarded` and `run_exited`, joined by `jobId`, into
`registry-row.py --run-dir`. A single run's `cancelled_or_deadline` then counts as the operator's stop only when the launcher
recorded a forwarded signal (HARN-12). Until then the registry passes `stop_signalled` false for single runs.
