module.exports = {
  roots: ["<rootDir>/src"],
  collectCoverageFrom: [
    "src/**/*.{js,jsx,ts,tsx}",
    "!src/**/*.d.ts",
    "!src/mocks/**",
  ],
  setupFilesAfterEnv: ["<rootDir>/src/setupTests.js"],
  coveragePathIgnorePatterns: [],
  testEnvironment: "jsdom",
  modulePaths: ["<rootDir>/src"],
  transform: {
    "^.+\\.(ts|js|tsx|jsx)$": ["@swc/jest"],
    "^.+\\.css$": "<rootDir>/config/jest/cssTransform.js",
    "^(?!.*\\.(js|jsx|mjs|cjs|ts|tsx|css|json)$)":
      "<rootDir>/config/jest/fileTransform.js",
  },
  transformIgnorePatterns: [
    "^.+\\.module\\.(css|sass|scss)$",
    "<rootDir>[/\\\\]node_modules[/\\\\](?!react-dnd|dnd-core|@react-dnd|react-dnd-scrolling|react-dnd-html5-backend|age-encryption|@noble)",
  ],
  modulePaths: ["<rootDir>/src"],
  moduleNameMapper: {
    "^react-native$": "react-native-web",
    "^.+\\.module\\.(css|sass|scss)$": "identity-obj-proxy",
    uuid: require.resolve("uuid"),
    "^.+\\.(png)$": "<rootDir>/config/jest/fileMock.js",
  },
  watchPlugins: [
    "jest-watch-typeahead/filename",
    "jest-watch-typeahead/testname",
  ],
  moduleFileExtensions: [
    // Place tsx and ts to beginning as suggestion from Jest team
    // https://jestjs.io/docs/configuration#modulefileextensions-arraystring
    "tsx",
    "ts",
    "web.js",
    "js",
    "web.ts",
    "web.tsx",
    "json",
    "web.jsx",
    "jsx",
    "node",
  ],
  resetMocks: true,
  testTimeout: 35000,
};
