const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.watchFolders = [
  ...new Set([
    ...(config.watchFolders || []),
    path.resolve(__dirname, '../..'),
  ]),
];

module.exports = config;
