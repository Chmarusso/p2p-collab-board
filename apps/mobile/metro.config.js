const { getDefaultConfig: getRNConfig, mergeConfig } = require('@react-native/metro-config')
const { getDefaultConfig: getExpoConfig } = require('expo/metro-config')

module.exports = mergeConfig(getRNConfig(__dirname), getExpoConfig(__dirname))
