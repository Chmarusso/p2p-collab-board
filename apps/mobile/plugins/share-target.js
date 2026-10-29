'use strict'

// Puts OpenCollab in Android's Share menu for text and links (a post from X,
// a YouTube video, a page from the browser). Android delivers a share as
// ACTION_SEND with the text in extras, while React Native's Linking only
// reports ACTION_VIEW links, so MainActivity turns the share into an
// opencollab://share?text=…&subject=… link before React Native sees it. The app
// then reads it like any deep link, without a native module.

const { withAndroidManifest, withMainActivity } = require('expo/config-plugins')

const MARKER = '// @opencollab share target'

const SHARE_AS_LINK = `  ${MARKER}
  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(shareAsLink(intent))
  }

  private fun shareAsLink(intent: Intent): Intent {
    if (intent.action != Intent.ACTION_SEND || intent.type?.startsWith("text/") != true) return intent
    val link = Uri.Builder().scheme("opencollab").authority("share")
    intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.let { link.appendQueryParameter("text", it.toString()) }
    intent.getStringExtra(Intent.EXTRA_SUBJECT)?.let { link.appendQueryParameter("subject", it) }
    intent.action = Intent.ACTION_VIEW
    intent.data = link.build()
    return intent
  }

  override fun getMainComponentName()`

function addShareFilter(manifest) {
  const activity = manifest.manifest.application?.[0]?.activity?.find(
    (item) => item.$['android:name'] === '.MainActivity'
  )
  if (!activity) throw new Error('share-target plugin: MainActivity missing from the manifest')
  const filters = (activity['intent-filter'] ||= [])
  const present = filters.some((filter) =>
    filter.action?.some((action) => action.$['android:name'] === 'android.intent.action.SEND')
  )
  if (present) return
  filters.push({
    action: [{ $: { 'android:name': 'android.intent.action.SEND' } }],
    category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
    data: [{ $: { 'android:mimeType': 'text/plain' } }]
  })
}

function patchActivity(contents) {
  if (contents.includes(MARKER)) return contents
  const anchors = [
    'import android.os.Bundle',
    'super.onCreate(',
    'override fun getMainComponentName()'
  ]
  if (anchors.some((anchor) => !contents.includes(anchor))) {
    // Fail the prebuild rather than ship an app that silently ignores shares.
    throw new Error('share-target plugin: MainActivity.kt layout changed, update the plugin')
  }
  return contents
    .replace(
      'import android.os.Bundle',
      'import android.content.Intent\nimport android.net.Uri\nimport android.os.Bundle'
    )
    .replace('super.onCreate(', 'shareAsLink(intent)\n    super.onCreate(')
    .replace('  override fun getMainComponentName()', SHARE_AS_LINK)
}

module.exports = function shareTarget(config) {
  config = withAndroidManifest(config, (config) => {
    addShareFilter(config.modResults)
    return config
  })
  return withMainActivity(config, (config) => {
    if (config.modResults.language !== 'kt') {
      throw new Error('share-target plugin: expected a Kotlin MainActivity')
    }
    config.modResults.contents = patchActivity(config.modResults.contents)
    return config
  })
}
