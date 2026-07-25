#!/usr/bin/env bash
# ============================================================
#  MarkWise – Android Release Keystore Generator (macOS/Linux)
# ============================================================
#  Run once before your first release build:
#    bash scripts/generate-keystore.sh
#
#  Requires a JDK (keytool) to be available on your PATH.
# ============================================================

set -e

KEYSTORE_NAME="markwise-release.keystore"
KEYSTORE_DEST="android/app/$KEYSTORE_NAME"
GRADLE_PROPS="android/gradle.properties"

echo ""
echo "=== MarkWise Android Release Keystore Generator ==="
echo ""

if [ -f "$KEYSTORE_DEST" ]; then
  echo "Warning: $KEYSTORE_DEST already exists."
  read -p "Overwrite? (y/N) " overwrite
  [ "$overwrite" != "y" ] && exit 0
fi

read -sp "Enter keystore (store) password: " STORE_PASS; echo
read -sp "Enter key password (can match store password): " KEY_PASS; echo
read -p  "Enter your name or organisation: " CN
read -p  "Enter organisational unit (e.g. Engineering): " OU
read -p  "Enter organisation (e.g. MarkWise): " ORG
read -p  "Enter city: " CITY
read -p  "Enter state / county: " STATE
read -p  "Enter 2-letter country code (e.g. GB): " COUNTRY

DNAME="CN=${CN}, OU=${OU}, O=${ORG}, L=${CITY}, ST=${STATE}, C=${COUNTRY}"

echo ""
echo "Generating keystore at $KEYSTORE_DEST ..."

keytool \
  -genkeypair \
  -v \
  -keystore "$KEYSTORE_DEST" \
  -alias markwise \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storepass "$STORE_PASS" \
  -keypass "$KEY_PASS" \
  -dname "$DNAME"

# Patch gradle.properties (works on both macOS and Linux)
sed -i.bak "s|MYAPP_UPLOAD_STORE_PASSWORD=.*|MYAPP_UPLOAD_STORE_PASSWORD=${STORE_PASS}|" "$GRADLE_PROPS"
sed -i.bak "s|MYAPP_UPLOAD_KEY_PASSWORD=.*|MYAPP_UPLOAD_KEY_PASSWORD=${KEY_PASS}|"   "$GRADLE_PROPS"
rm -f "${GRADLE_PROPS}.bak"

echo ""
echo "Done! gradle.properties has been updated."
echo ""
echo "IMPORTANT:"
echo "  1. Add android/app/$KEYSTORE_NAME to .gitignore"
echo "  2. Back the keystore file up — losing it means you cannot update your app."
echo "  3. The passwords are now stored in gradle.properties — do NOT commit that file."
echo ""
echo "Build a release APK:  npm run build:android:apk"
echo "Build a release AAB:  npm run build:android:aab"
echo ""
