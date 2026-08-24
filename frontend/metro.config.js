// metro.config.js
const { getDefaultConfig } = require("expo/metro-config");
const path = require('path');
const { FileStore } = require('metro-cache');

const config = getDefaultConfig(__dirname);

// Use a stable on-disk store (shared across web/android)
const root = process.env.METRO_CACHE_ROOT || path.join(__dirname, '.metro-cache');
config.cacheStores = [
  new FileStore({ root: path.join(root, 'cache') }),
];


// // Exclude unnecessary directories from file watching
// config.watchFolders = [__dirname];
// config.resolver.blacklistRE = /(.*)\/(__tests__|android|ios|build|dist|.git|node_modules\/.*\/android|node_modules\/.*\/ios|node_modules\/.*\/windows|node_modules\/.*\/macos)(\/.*)?$/;

// // Alternative: use a more aggressive exclusion pattern
// config.resolver.blacklistRE = /node_modules\/.*\/(android|ios|windows|macos|__tests__|\.git|.*\.android\.js|.*\.ios\.js)$/;

// Reduce the number of workers to decrease resource usage
config.maxWorkers = 2;

// `ws` is only ever needed for the web SSR WebSocket polyfill in
// supabaseClient.ts (see the comment there) — native platforms already
// have a real global WebSocket, so that branch never actually runs there.
// The problem is that Metro still tries to statically RESOLVE `require('ws')`
// when bundling for Android/iOS, regardless of whether the runtime branch
// executes — and `ws` pulls in Node's `stream` module, which doesn't exist
// in React Native's JS engine, so bundling fails outright before the app
// ever runs. Stubbing `ws` out for non-web platforms stops Metro from
// trying to resolve it there at all, while leaving it fully intact for web.
config.resolver.resolveRequest = (context, moduleName, platform, ...rest) => {
  if (moduleName === 'ws' && platform !== 'web') {
    return { type: 'empty' };
  }
  return context.resolveRequest(context, moduleName, platform, ...rest);
};

module.exports = config;
