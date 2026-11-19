module.exports = function (api) {
  api.cache(true);
  const base = { unstable_transformImportMeta: true };
  return {
    presets: [["babel-preset-expo", base]],
    // The app's own code uses lib/i18n's JSX runtime, which shows Hindi when chosen.
    overrides: [{
      test: (file) => !!file && !file.includes("node_modules") && !file.includes("lib/i18n/"),
      presets: [["babel-preset-expo", { ...base, jsxImportSource: "@/lib/i18n" }]],
    }],
  };
};
