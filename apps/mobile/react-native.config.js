/**
 * Project-level React Native config.
 *
 * This file overrides expo's android autolinking config because pnpm's
 * isolated node_modules means the `expo` package cannot resolve
 * `expo-modules-autolinking/exports` at require-time, causing
 * expo/react-native.config.js to throw silently.  The fallback in
 * expo-modules-autolinking@2.0.8 then constructs the import path from
 * the Gradle `namespace` ("expo.core") rather than the actual class
 * location ("expo.modules"), producing:
 *
 *   import expo.core.ExpoModulesPackage;   // WRONG — class not found
 *
 * This override restores the correct import:
 *
 *   import expo.modules.ExpoModulesPackage;   // correct
 */
module.exports = {
  dependencies: {
    expo: {
      platforms: {
        android: {
          packageImportPath: 'import expo.modules.ExpoModulesPackage;',
        },
      },
    },
  },
};
