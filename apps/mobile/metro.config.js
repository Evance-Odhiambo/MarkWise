const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = mergeConfig(getDefaultConfig(__dirname), {
  resolver: {
    blockList: /(?:android[/\\](?:build|\.gradle|app[/\\]build|app[/\\]\.cxx)|ios[/\\](?:build|Pods)|coverage)[/\\].*/,
  },

  transformer: {
    getTransformOptions: async () => ({
      transform: {
        experimentalImportSupport: false,
        inlineRequires: true,
      },
    }),
  },

  maxWorkers: 4,
});

module.exports = withNativeWind(config, { input: './global.css' });
