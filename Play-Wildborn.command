#!/bin/bash
# Double-click this file on macOS to start Wildborn.
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display alert "Wildborn" message "Node.js is required. Install it from https://nodejs.org/ then try again."'
  exit 1
fi

if [ ! -d "node_modules/electron" ]; then
  echo "Installing Wildborn dependencies (first run only)..."
  npm install || {
    osascript -e 'display alert "Wildborn" message "npm install failed. Open Terminal in this folder and run: npm install"'
    exit 1
  }
fi

npm start
status=$?
if [ $status -ne 0 ]; then
  osascript -e 'display alert "Wildborn" message "Wildborn failed to start. Open Terminal in this folder and run: npm start"'
  exit $status
fi
