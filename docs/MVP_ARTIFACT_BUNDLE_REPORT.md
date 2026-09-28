# Artifact bundle delivery

Status: Implemented; host behavior verified. Desktop interaction proof remains open.
Date: 2026-09-14.

The existing general task now lists all saved output files, including nested
assets, instead of exposing only its one required primary output. Users can still
preview or export individual files, or choose **Export all as ZIP** to save the
complete output inventory through the native dialog. Input files and work files
are excluded. The ZIP removes the leading output/ directory and preserves relative
folders, so HTML, CSS, JavaScript and data can travel together.

The displayed inventory includes file sizes and a manifest identity. The host
rechecks this exact inventory after the save dialog, verifies checkpoint bytes
and rejects stale references, active execution or unconfirmed cleanup. The same
atomic destination checks protect individual and ZIP exports. HTML preview stays
inert; exporting an incomplete task does not change its status or acceptance.
No model or network request is made by export.

The dependency-free ZIP writer stores regular files, fixed timestamps and UTF-8
names. It checks traversal, absolute/drive-like paths, reserved device names,
case/Unicode collisions and file/directory conflicts. It keeps the existing
checkpoint limits: 1024 files, 64 MiB per file and 128 MiB total. Incompatible
names disable bundle export with an explanation; individual exports remain.

Verification: 81 controller/IPC assertions and 51 ZIP assertions passed. Python's
independent zipfile reader checked archive CRCs, metadata and exact nested binary
and Unicode bytes. Both application typechecks, scoped module/renderer types,
the normal production build and independent source review passed. The combined
host/renderer invocation exited with a worker error despite its 81 host passes.
The renderer worker then also failed to start in an isolated unrestricted fork
and a threads run, each before assertions. Its six new UI cases therefore remain
unrun. The initial ZIP-test CLI used an unsupported flag; the corrected command
passed. Preserve these negative results; no GUI verification is claimed.

This implementation closes a concrete export limitation. It does not establish
a model-generated, accepted multi-file website or the full first MVP. Next verify
the inventory, stale-reference behavior, native ZIP destination and extracted
relative assets in the desktop, after fixing the trial's process supervision.
A later real task requires its own identified bounded execution.

The preceding real website trial remains closed. The controller lost its page
after 51 seconds; the app continued and retained a draft, but no native export
or independent evaluation occurred. Final database exposure was ten requests,
nine settled and one unknown. Its driver required watchdog termination; the
leftover trial app was later identified and terminated. Those failures are not
reclassified as successful delivery by this bundle feature.
