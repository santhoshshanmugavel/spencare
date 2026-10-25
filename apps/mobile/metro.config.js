const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Watch the monorepo root so Metro sees pnpm's virtual store and workspace packages.
config.watchFolders = [monorepoRoot];

// Look for node_modules in both the app directory and the monorepo root.
// Required for pnpm workspaces where packages are hoisted to root/node_modules/.pnpm.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// pnpm uses symlinks — Metro must follow them to reach the actual package files.
config.resolver.unstable_enableSymlinks = true;

module.exports = config;
