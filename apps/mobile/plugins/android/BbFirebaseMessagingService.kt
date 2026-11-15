package app.getbb.notifications

import android.content.Intent
import android.os.Bundle
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService
import expo.modules.notifications.service.delegates.ExpoHandlingDelegate

class BbFirebaseMessagingService : ExpoFirebaseMessagingService() {
  override fun handleIntent(intent: Intent) {
    val extras = intent.extras
    if (
      intent.action == "com.google.android.c2dm.intent.RECEIVE" &&
      extras?.getString("categoryId") == "bb-thread-reply" &&
      !ExpoHandlingDelegate(this).isAppInForeground()
    ) {
      val notification = RemoteMessage(extras).notification
      if (notification != null) {
        val payload = Bundle(extras)
        payload.putString("title", notification.title)
        payload.putString("message", notification.body)
        payload.putString("gcm.n.e", "0")
        payload.putString("gcm.notification.e", "0")
        intent.replaceExtras(payload)
      }
    }
    super.handleIntent(intent)
  }
}
