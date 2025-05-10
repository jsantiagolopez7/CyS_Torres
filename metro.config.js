// metro.config.js
const { getDefaultConfig } = require("expo/metro-config");
const config = getDefaultConfig(__dirname);

// Agregar extensión db a assetExts
config.resolver.assetExts.push("db");

// Solución para módulos nativos problemáticos
config.resolver = {
  ...config.resolver,
  extraNodeModules: {
    ...config.resolver.extraNodeModules,
    idb: require.resolve("./mocks/empty.js"),

    // Mock para PlatformConstants que causa el problema
    PlatformConstants: require.resolve("./mocks/platformConstants.js"),
  },
  // Excluir bibliotecas problemáticas del bundle
  blockList: [/node_modules\/lucide-react-native\/.*/],
};

module.exports = config;
