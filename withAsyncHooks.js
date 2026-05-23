/**
 * Plasmo extension config to polyfill node:async_hooks
 */
module.exports = {
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "node:async_hooks": require.resolve("./src/polyfills/async_hooks.ts"),
      "async_hooks": require.resolve("./src/polyfills/async_hooks.ts"),
    };
    return config;
  },
};
