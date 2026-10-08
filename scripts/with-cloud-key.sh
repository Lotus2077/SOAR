#!/bin/sh
# Runs one command with the Phase 2 cloud API key in SOAR_PHASE2_CLOUD_API_KEY, read
# from the macOS login Keychain at launch. The key is never written to a file, a .env
# file, the shell history or a command line, and the driver records no key anywhere.
#
# Store the key once; macOS prompts for the value, so it never appears on a command line:
#   security add-generic-password -U -a "$USER" -s soar-phase2-cloud-api-key -w
# After rotating the key, store the new one the same way and raise
# SOAR_PHASE2_CLOUD_CREDENTIAL_VERSION so new cloud settlements bind to the new credential.
#
# Usage: scripts/with-cloud-key.sh pnpm exec tsx scripts/private-agent-local-screen.ts --arm cloud ...
set -eu

if [ "$#" -eq 0 ]; then
  echo "usage: scripts/with-cloud-key.sh <command> [args...]" >&2
  exit 64
fi

if ! key=$(security find-generic-password -a "$USER" -s soar-phase2-cloud-api-key -w 2>/dev/null) || [ -z "$key" ]; then
  echo "with-cloud-key: no Keychain item soar-phase2-cloud-api-key; store it first (see the header)" >&2
  exit 69
fi

SOAR_PHASE2_CLOUD_API_KEY=$key
export SOAR_PHASE2_CLOUD_API_KEY
unset key
exec "$@"
