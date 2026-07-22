#!/bin/sh
set -e

# Sessions must survive container recreation: generate the cookie-sealing
# secret once and persist it in the data volume unless the user supplied one.
if [ -z "$NUXT_SESSION_PASSWORD" ]; then
  SECRET_FILE="${BETTS_DATA_DIR:-/data}/.session-secret"
  if [ ! -f "$SECRET_FILE" ]; then
    node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))" > "$SECRET_FILE"
    chmod 600 "$SECRET_FILE"
  fi
  NUXT_SESSION_PASSWORD="$(cat "$SECRET_FILE")"
  export NUXT_SESSION_PASSWORD
fi

exec "$@"
