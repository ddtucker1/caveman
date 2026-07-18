#!/bin/bash
# Double-click or run this script on Linux to start Wildborn.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install it from https://nodejs.org/ then try again."
  read -r -p "Press Enter to close..."
  exit 1
fi

if [ ! -d "node_modules/electron" ]; then
  echo "Installing Wildborn dependencies (first run only)..."
  npm install || {
    echo "npm install failed."
    read -r -p "Press Enter to close..."
    exit 1
  }
fi

npm start
status=$?
if [ $status -ne 0 ]; then
  echo "Wildborn failed to start."
  read -r -p "Press Enter to close..."
  exit $status
fi
