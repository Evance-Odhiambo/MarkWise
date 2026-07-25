#!/usr/bin/env node
const { execSync } = require('child_process');
const path = require('path');

const androidDir = path.join(__dirname, '..', 'android');
const isWin = process.platform === 'win32';
const gradlew = path.join(androidDir, isWin ? 'gradlew.bat' : 'gradlew');
const args = process.argv.slice(2).join(' ');

const cmd = isWin ? `"${gradlew}" ${args}` : `"${gradlew}" ${args}`;

try {
  execSync(cmd, { stdio: 'inherit', cwd: androidDir, shell: isWin });
} catch (e) {
  process.exit(e.status ?? 1);
}
