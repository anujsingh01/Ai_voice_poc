#!/bin/bash
# Serves the test page on http://localhost:8000 (the mic only works on localhost or https).
cd "$(dirname "$0")"
# Node installed through nvm is not on the PATH when this file is double-clicked; load nvm if needed.
if ! command -v node >/dev/null 2>&1 && [ -s "$HOME/.nvm/nvm.sh" ]; then
  . "$HOME/.nvm/nvm.sh"
fi
open -a "Google Chrome" "http://localhost:8000" 2>/dev/null || open "http://localhost:8000"
node server.js 8000
