const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration — performance-optimised for Windows dev + CI.
 * https://reactnative.dev/docs/metro
 */
const config = {
  resolver: {
    // Exclude build artefacts and generated folders from the file watcher.
    // Without this Metro watches thousands of extra files produced by every
    // Gradle build, which causes very slow hot-reload on Windows.
    blockList: /(?:android[/\\](?:build|\.gradle|app[/\\]build|app[/\\]\.cxx)|ios[/\\](?:build|Pods)|coverage)[/\\].*/,
  },

  transformer: {
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        // Defers require() calls until the module is actually used.
        // Cuts both cold-start time and hot-reload time significantly.
        inlineRequires: true,
      },
    }),
  },

  // Cap worker count on Windows. More workers add IPC overhead rather than
  // speeding things up on a single-socket Windows machine.
  maxWorkers: 4,
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
