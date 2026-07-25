#!/usr/bin/env node
/**
 * Removes the deprecated `package=` attribute from third-party AndroidManifest.xml
 * files that haven't been updated for AGP 8.x. This is idempotent — safe to run
 * multiple times. Run automatically via the `postinstall` npm script.
 */
const fs = require('fs');
const path = require('path');

const fixes = [
  {
    file: 'node_modules/react-native-vector-icons/android/src/main/AndroidManifest.xml',
    remove: ' package="com.oblador.vectoricons"',
  },
];

for (const { file, remove } of fixes) {
  const filePath = path.resolve(__dirname, '..', file);
  if (!fs.existsSync(filePath)) continue;
  const original = fs.readFileSync(filePath, 'utf8');
  if (!original.includes(remove)) continue; // already clean
  fs.writeFileSync(filePath, original.replace(remove, ''), 'utf8');
  console.log(`[fix-manifests] Patched: ${file}`);
}
