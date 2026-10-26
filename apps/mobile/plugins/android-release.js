'use strict'

// Android settings that `expo prebuild` would otherwise reset, since android/ is
// generated and not committed:
// - minSdk 29, the lowest version react-native-bare-kit supports.
// - Release signing from the environment. With ANDROID_KEYSTORE_PATH set, release
//   builds are signed with that keystore; without it they keep the debug key, so
//   local release builds still work. Never commit the keystore or its passwords.
//
//   ANDROID_KEYSTORE_PATH      path to the .jks file
//   ANDROID_KEYSTORE_PASSWORD  store password
//   ANDROID_KEY_ALIAS          key alias
//   ANDROID_KEY_PASSWORD       key password

const { withAppBuildGradle, withGradleProperties } = require('expo/config-plugins')

const MIN_SDK = '29'
const MARKER = '// @opencollab release signing'

const RELEASE_SIGNING = `signingConfigs {
        ${MARKER}
        release {
            if (System.getenv('ANDROID_KEYSTORE_PATH')) {
                storeFile file(System.getenv('ANDROID_KEYSTORE_PATH'))
                storePassword System.getenv('ANDROID_KEYSTORE_PASSWORD')
                keyAlias System.getenv('ANDROID_KEY_ALIAS')
                keyPassword System.getenv('ANDROID_KEY_PASSWORD')
            }
        }`

function setProperty(properties, key, value) {
  const existing = properties.find((item) => item.type === 'property' && item.key === key)
  if (existing) existing.value = value
  else properties.push({ type: 'property', key, value })
}

function patchSigning(contents) {
  if (contents.includes(MARKER)) return contents
  // The release build type is the first block that signs with the debug key
  // after `release {` inside buildTypes.
  const buildType = /(buildTypes \{[\s\S]*?release \{[\s\S]*?)signingConfig signingConfigs\.debug/
  if (!buildType.test(contents) || !contents.includes('signingConfigs {')) {
    // Fail the prebuild rather than ship an APK signed with the debug key.
    throw new Error('android-release plugin: app/build.gradle layout changed, update the plugin')
  }
  return contents
    .replace(
      buildType,
      "$1signingConfig System.getenv('ANDROID_KEYSTORE_PATH') ? signingConfigs.release : signingConfigs.debug"
    )
    .replace('signingConfigs {', RELEASE_SIGNING)
}

module.exports = function androidRelease(config) {
  config = withGradleProperties(config, (config) => {
    setProperty(config.modResults, 'android.minSdkVersion', MIN_SDK)
    return config
  })
  return withAppBuildGradle(config, (config) => {
    config.modResults.contents = patchSigning(config.modResults.contents)
    return config
  })
}
