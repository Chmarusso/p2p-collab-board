package expo.modules.opencollabnotify

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Local notifications for board alerts. The app works out what is new (on the
// phone, from boards it synced) and posts it here; nothing goes through Google.
// Tapping one opens the app at `url` (an opencollab:// link).
class OpenCollabNotifyModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("OpenCollabNotify")

    Function("enabled") {
      NotificationManagerCompat.from(context).areNotificationsEnabled()
    }

    Function("post") { id: Int, title: String, body: String, url: String, channelName: String, publicText: String ->
      val manager = NotificationManagerCompat.from(context)
      if (!manager.areNotificationsEnabled()) return@Function false
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val channel = NotificationChannel(CHANNEL, channelName, NotificationManager.IMPORTANCE_DEFAULT)
        channel.lockscreenVisibility = NotificationCompat.VISIBILITY_PRIVATE
        context.getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
      }
      val open = Intent(Intent.ACTION_VIEW, Uri.parse(url))
        .setPackage(context.packageName)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      val tap = PendingIntent.getActivity(
        context, id, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
      // What the lock screen shows when the user hides sensitive content.
      val public = NotificationCompat.Builder(context, CHANNEL)
        .setSmallIcon(R.drawable.opencollab_notify)
        .setContentTitle("OpenCollab")
        .setContentText(publicText)
        .build()
      val notification = NotificationCompat.Builder(context, CHANNEL)
        .setSmallIcon(R.drawable.opencollab_notify)
        .setContentTitle(title)
        .setContentText(body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(body))
        .setContentIntent(tap)
        .setAutoCancel(true)
        .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
        .setPublicVersion(public)
        .build()
      try {
        manager.notify(id, notification)
        true
      } catch (_: SecurityException) {
        false
      }
    }
  }

  companion object {
    private const val CHANNEL = "board-alerts"
  }
}
