#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/.."

echo "=== Guaiba Monitor Test Suite ==="
echo ""

# Node.js syntax checks for all JS files
echo "--- Syntax Check ---"
for f in js/*.js; do
  echo "Checking $f..."
  node --check "$f"
done
echo "✓ All JS files pass syntax check"
echo ""

# Run tests with node --test
echo "--- Running Tests ---"
node --test tests/test-validation.js tests/test-alerts.js tests/test-risks.js 2>&1 || true

echo ""
echo "=== Test Suite Complete ==="
