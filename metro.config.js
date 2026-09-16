const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// Firebase v12 support: Ensure .cjs files are resolved
config.resolver.sourceExts.push('cjs');

// Workaround for Zustand v5 and other ESM libraries failing with 'import.meta'
config.resolver.unstable_enablePackageExports = false;

module.exports = withNativeWind(config, { input: "./global.css" });
