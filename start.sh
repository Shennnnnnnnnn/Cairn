#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ ! -f dist/cairn.mjs ]; then
  npm run build
fi
exec node bin/cairn.mjs "$@"
