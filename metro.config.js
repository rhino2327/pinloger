const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// 번들 최적화
config.transformer = {
  ...config.transformer,
  minifierConfig: {
    keep_classnames: false,
    keep_fnames: false,
    mangle: { toplevel: false },
    output: { comments: false },
    sourceMap: false,
  },
};

// 불필요한 파일 제외
config.resolver = {
  ...config.resolver,
  blockList: [
    /.*\/__tests__\/.*/,
    /.*\/android\/.*\.java/,
  ],
};

module.exports = config;
