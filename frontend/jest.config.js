const jestExpoPreset = require('jest-expo/jest-preset.js');

module.exports = {
  preset: 'jest-expo',
  testPathIgnorePatterns: ['/node_modules/', '/.expo/'],
  // react-native's own preset needs its own setup.js — a top-level
  // setupFiles array REPLACES the preset's, it doesn't merge with it, so
  // it needs listing explicitly or RN's own native-module mocking never
  // runs at all.
  setupFiles: [require.resolve('react-native/jest/setup.js')],
  // AsyncStorage's mock file just exports a plain object — it has no
  // jest.mock() call of its own, so listing it in setupFiles does
  // nothing useful on its own. moduleNameMapper redirects the import
  // itself, which is what actually makes offlineSync.ts's tests work.
  // Merged explicitly with jest-expo's own mapper (vector-icons aliasing)
  // rather than replacing it — a plain top-level object here would
  // silently drop that aliasing, the same "replace not merge" trap as
  // setupFiles above.
  moduleNameMapper: {
    ...jestExpoPreset.moduleNameMapper,
    '^@react-native-async-storage/async-storage$':
      '@react-native-async-storage/async-storage/jest/async-storage-mock',
  },
  // Pure-logic unit tests (dateUtils, lessonTypes, etc.) never touch
  // React Native rendering, so they don't need the jest-expo transform's
  // slower React Native setup — but sharing one preset for now keeps the
  // config simple. Split this out once real component tests are added.
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
  ],
};
