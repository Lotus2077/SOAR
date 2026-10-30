#!/bin/sh
# Runs one command with the Claude API key in SOAR_CLAUDE_CLOUD_API_KEY, read from the macOS
# login Keychain at launch (BL-20261030-0620). The key is never written to a file, a .env file,
# the shell history or a command line, and the driver records no key anywhere. The OpenAI key's
# variable is unset first, so a command run here can only ever send the Claude key.
#
# Store or replace the key (input hidden; the value reaches `security` on stdin, never argv):
#   scripts/with-claude-key.sh --store
# Check it with one free model-list request that prints only the HTTP status:
#   scripts/with-claude-key.sh --check
# After rotating the key, store the new one and raise SOAR_CLAUDE_CLOUD_CREDENTIAL_VERSION
# so new cloud settlements bind to the new credential.
#
# Usage: scripts/with-claude-key.sh node --import tsx scripts/private-agent-local-screen.ts --arm cloud ...
set -eu

SERVICE=soar-h5-claude-api-key
API_VERSION=2026-10-21

if [ "$#" -eq 0 ]; then
  echo "usage: scripts/with-claude-key.sh --store | --check | <command> [args...]" >&2
  exit 64
fi

if [ "$1" = "--store" ]; then
  if [ ! -t 0 ]; then
    echo "with-claude-key --store: run it in a terminal" >&2
    exit 64
  fi
  printf "Paste the Claude API key (input hidden), then press Return: " >&2
  stty -echo
  trap 'stty echo' EXIT INT TERM
  read -r key || key=
  stty echo
  trap - EXIT INT TERM
  echo >&2
  case "$key" in
    "" | *[!A-Za-z0-9_-]*)
      echo "with-claude-key: that does not look like an API key; nothing stored" >&2
      exit 65
      ;;
  esac
  printf 'add-generic-password -U -a "%s" -s %s -l "SOAR H5 Claude API key" -w "%s"\n' "$USER" "$SERVICE" "$key" | security -i
  echo "Stored ${#key} characters in the login Keychain as $SERVICE" >&2
  exit 0
fi

if ! key=$(security find-generic-password -a "$USER" -s "$SERVICE" -w 2>/dev/null) || [ -z "$key" ]; then
  echo "with-claude-key: no Keychain item $SERVICE; run scripts/with-claude-key.sh --store first" >&2
  exit 69
fi

if [ "$1" = "--check" ]; then
  status=$(printf 'header = "x-api-key: %s"\nheader = "anthropic-version: %s"\n' "$key" "$API_VERSION" |
    curl -s -K - --max-time 20 -o /dev/null -w "%{http_code}" https://api.anthropic.com/v1/models || true)
  unset key
  echo "models endpoint HTTP $status (200 = key accepted)"
  [ "$status" = "200" ]
  exit
fi

unset SOAR_PHASE2_CLOUD_API_KEY
SOAR_CLAUDE_CLOUD_API_KEY=$key
export SOAR_CLAUDE_CLOUD_API_KEY
unset key
exec "$@"
