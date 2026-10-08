#!/bin/sh
# Runs one command with the Phase 2 cloud API key in SOAR_PHASE2_CLOUD_API_KEY, read
# from the macOS login Keychain at launch. The key is never written to a file, a .env
# file, the shell history or a command line, and the driver records no key anywhere.
#
# Store or replace the key (input hidden; the value reaches `security` on stdin, never argv):
#   scripts/with-cloud-key.sh --store
# Do not use `security add-generic-password -w` at a prompt: macOS truncates prompted
# passwords to 128 characters, and OpenAI project keys are longer.
# Check it with one free request that prints only the HTTP status:
#   scripts/with-cloud-key.sh --check
# After rotating the key, store the new one and raise SOAR_PHASE2_CLOUD_CREDENTIAL_VERSION
# so new cloud settlements bind to the new credential.
#
# Usage: scripts/with-cloud-key.sh pnpm exec tsx scripts/private-agent-local-screen.ts --arm cloud ...
set -eu

SERVICE=soar-phase2-cloud-api-key

if [ "$#" -eq 0 ]; then
  echo "usage: scripts/with-cloud-key.sh --store | --check | <command> [args...]" >&2
  exit 64
fi

if [ "$1" = "--store" ]; then
  if [ ! -t 0 ]; then
    echo "with-cloud-key --store: run it in a terminal" >&2
    exit 64
  fi
  printf "Paste the API key (input hidden), then press Return: " >&2
  stty -echo
  trap 'stty echo' EXIT INT TERM
  read -r key || key=
  stty echo
  trap - EXIT INT TERM
  echo >&2
  case "$key" in
    "" | *[!A-Za-z0-9_-]*)
      echo "with-cloud-key: that does not look like an API key; nothing stored" >&2
      exit 65
      ;;
  esac
  printf 'add-generic-password -U -a "%s" -s %s -l "SOAR Phase 2 cloud API key" -w "%s"\n' "$USER" "$SERVICE" "$key" | security -i
  echo "Stored ${#key} characters in the login Keychain as $SERVICE" >&2
  exit 0
fi

if ! key=$(security find-generic-password -a "$USER" -s "$SERVICE" -w 2>/dev/null) || [ -z "$key" ]; then
  echo "with-cloud-key: no Keychain item $SERVICE; run scripts/with-cloud-key.sh --store first" >&2
  exit 69
fi

if [ "$1" = "--check" ]; then
  printf 'header = "Authorization: Bearer %s"\n' "$key" |
    curl -s -K - --max-time 20 -o /dev/null -w "models endpoint HTTP %{http_code} (200 = key accepted)\n" https://api.openai.com/v1/models
  exit 0
fi

SOAR_PHASE2_CLOUD_API_KEY=$key
export SOAR_PHASE2_CLOUD_API_KEY
unset key
exec "$@"
