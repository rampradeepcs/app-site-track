#!/usr/bin/env bash
#
# Rebuild a signed Play bundle at a given version code.
#
# Play rejects any version code it has seen before, on any track, including
# drafts you never rolled out. When it does, you do not need a new build —
# only a new number. This does that in one step.
#
#   ./scripts/play-bundle.sh 11          # phone only
#   ./scripts/play-bundle.sh 11 --wear   # phone and watch
#
# The watch code is always the phone code + 1000, because two artifacts of
# one app may never share a code.

set -euo pipefail

CODE="${1:-}"
WANT_WEAR="${2:-}"

if ! [[ "$CODE" =~ ^[0-9]+$ ]]; then
  echo "usage: $0 <versionCode> [--wear]" >&2
  echo "       version codes already used on Play: see Play Console →" >&2
  echo "       Test and release → App bundle explorer" >&2
  exit 1
fi
if [ "$CODE" -ge 2100000000 ]; then
  echo "error: Play's maximum version code is 2100000000" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WEAR_CODE=$((CODE + 1000))

# The JDK Gradle needs; the system java on this Mac is not always present.
for c in "/Applications/Android Studio.app/Contents/jbr/Contents/Home" \
         /opt/homebrew/Cellar/openjdk@21/*/libexec/openjdk.jdk/Contents/Home \
         /opt/homebrew/opt/openjdk/libexec/openjdk.jdk/Contents/Home; do
  [ -x "$c/bin/keytool" ] && export JAVA_HOME="$c" && break
done
[ -n "${JAVA_HOME:-}" ] || { echo "error: no JDK found" >&2; exit 1; }

[ -f "$ROOT/android/keystore.properties" ] || {
  echo "error: android/keystore.properties missing — the bundle would be unsigned" >&2
  exit 1
}

echo "==> phone versionCode $CODE"
sed -i '' -E "s/versionCode [0-9]+/versionCode $CODE/" "$ROOT/android/app/build.gradle"
TARGETS=":app:bundleRelease"

if [ "$WANT_WEAR" = "--wear" ]; then
  echo "==> wear  versionCode $WEAR_CODE"
  sed -i '' -E "s/versionCode [0-9]+/versionCode $WEAR_CODE/" "$ROOT/android/wear/build.gradle"
  TARGETS="$TARGETS :wear:bundleRelease"
fi

( cd "$ROOT/android" && ./gradlew $TARGETS --console=plain -q )

VERSION_NAME=$(grep -m1 'versionName' "$ROOT/android/app/build.gradle" | tr -d ' versionName"')
OUT="$HOME/Downloads"

emit () {  # module, code, source path
  local src="$3"
  local dst="$OUT/workfence-$1-v$VERSION_NAME-code$2.aab"
  cp "$src" "$dst"
  local got
  got=$(python3 -c "
import zipfile,sys
m=zipfile.ZipFile('$dst').read('base/manifest/AndroidManifest.xml')
i=m.find(b'versionCode'); j=i+len(b'versionCode')
print(m[j+2:j+2+m[j+1]].decode('latin1') if m[j:j+1]==b'\x1a' else '?')")
  local signed
  signed=$("$JAVA_HOME/bin/jarsigner" -verify "$dst" 2>&1 | grep -c 'jar verified' || true)
  printf '%-52s code=%-8s signed=%s\n' "$(basename "$dst")" "$got" \
         "$([ "$signed" = 1 ] && echo yes || echo NO)"
  [ "$got" = "$2" ] || { echo "error: built code $got, expected $2" >&2; exit 1; }
}

echo
emit phone "$CODE" "$ROOT/android/app/build/outputs/bundle/release/app-release.aab"
[ "$WANT_WEAR" = "--wear" ] && \
  emit watch "$WEAR_CODE" "$ROOT/android/wear/build/outputs/bundle/release/wear-release.aab"

echo
echo "Upload from ~/Downloads. Remember to commit the version bump."
