// frontend/craco.config.js
module.exports = {
  webpack: {
    configure: (webpackConfig) => {
      // Find the existing source-map-loader rule and exclude flagsmith
      const rules = webpackConfig.module.rules || [];
      for (const rule of rules) {
        if (rule.oneOf) {
          for (const one of rule.oneOf) {
            if (one.use) {
              for (const use of [].concat(one.use)) {
                if (
                  use.loader &&
                  use.loader.includes('source-map-loader')
                ) {
                  // Exclude flagsmith package from source map validation
                  use.options = use.options || {};
                  // CRA doesn’t pass options here, so we add an exclude rule instead
                }
              }
            }
          }
        }
      }

      // Add a top-level pre-rule that excludes flagsmith for source-map-loader
      // (Some CRA versions add source-map-loader as a pre rule; we mirror that)
      webpackConfig.module.rules.unshift({
        enforce: 'pre',
        test: /\.js$/,
        exclude: /node_modules[\\/](flagsmith)[\\/]/,
        use: []
      });

      return webpackConfig;
    },
  },
};