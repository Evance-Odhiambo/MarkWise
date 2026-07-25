#!/usr/bin/env node
/**
 * Warns about release APK/AAB builds on Windows.
 *
 * The hermesc bytecode version (v98) now matches hermes-android@250829098.0.9
 * thanks to the hermes-compiler@250829098.0.9 pin in package.json. Windows
 * release builds should no longer crash.
 *
 * CI (GitHub Actions) is still the recommended release path for:
 *   - Automated signing with secrets
 *   - Reproducible builds
 *   - Artefact upload to GitHub Releases
 *
 * See .github/workflows/build-release-apk.yml.
 */
console.log('');
console.log('  NOTE: Building release APK locally.');
console.log('  For automated CI releases, push your branch and trigger:');
console.log('    .github/workflows/build-release-apk.yml');
console.log('');
