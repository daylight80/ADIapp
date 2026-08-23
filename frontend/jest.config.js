module.exports = {
  preset: 'jest-expo',
  testPathIgnorePatterns: ['/node_modules/', '/.expo/'],
  // Pure-logic unit tests (dateUtils, lessonTypes, etc.) never touch
  // React Native rendering, so they don't need the jest-expo transform's
  // slower React Native setup — but sharing one preset for now keeps the
  // config simple. Split this out once real component tests are added.
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
  ],
};
