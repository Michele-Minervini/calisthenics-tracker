#!/bin/sh
# Runs every test file, twice: in Italian time and in US Eastern time, because
# the two switch daylight-saving time on different dates and date bugs hide
# in exactly those weeks.
#   sh tests/run.sh
cd "$(dirname "$0")/.." || exit 1
status=0
for tz in Europe/Rome America/New_York; do
  for t in tests/*-test.js; do
    out=$(TZ=$tz node "$t" 2>&1)
    code=$?
    summary=$(printf '%s\n' "$out" | tail -1)
    if [ $code -ne 0 ]; then
      status=1
      printf '%s\n' "$out" | grep -E "FAIL|Error|error" | head -20
    fi
    echo "[$tz] $summary"
  done
done
if [ $status -eq 0 ]; then echo "All tests passed."; else echo "SOME TESTS FAILED."; fi
exit $status
