#!/bin/sh
# Sets the release stamp everywhere it has to match: the service worker's
# VERSION (which makes phones download the new release) and the stamp inside
# every script and index.html (which stops the app running on a mix of two
# releases). Each stamp is rewritten by its own pattern, so this also repairs
# stamps that have drifted apart. Once per release, before the tests:
#   sh tools/set-build.sh milo-v18
new="$1"
case "$new" in
  "" | *[!A-Za-z0-9._-]*)
    echo "usage: sh tools/set-build.sh <new-build>   e.g. milo-v18  (letters, digits, . _ - only)"
    exit 1 ;;
esac
cd "$(dirname "$0")/.." || exit 1
old=$(sed -n 's/^var VERSION = "\(.*\)";$/\1/p' sw.js)

# file | sed expression | grep pattern that must match afterwards
set_stamp() {
  sed -i.bak "$2" "$1" && rm -f "$1.bak" || { echo "failed to update $1"; exit 1; }
  grep -q "$3" "$1" || { echo "$1: stamp not found after update — check the file by hand"; exit 1; }
}
set_stamp sw.js      "s/^var VERSION = \"[^\"]*\";\$/var VERSION = \"$new\";/"   "^var VERSION = \"$new\";\$"
set_stamp index.html "s/data-build=\"[^\"]*\"/data-build=\"$new\"/"            "data-build=\"$new\""
set_stamp data.js    "s/^const DATA_BUILD = \"[^\"]*\";/const DATA_BUILD = \"$new\";/" "^const DATA_BUILD = \"$new\";"
set_stamp qrcode.js  "s/BUILD: \"[^\"]*\"/BUILD: \"$new\"/"                    "BUILD: \"$new\""
for f in model.js training.js radar.js sync.js app.js; do
  set_stamp "$f" "s/^  var BUILD = \"[^\"]*\";/  var BUILD = \"$new\";/"      "^  var BUILD = \"$new\";"
done
echo "build ${old:-?} -> $new in sw.js, index.html, data.js, qrcode.js, model.js, training.js, radar.js, sync.js, app.js"
