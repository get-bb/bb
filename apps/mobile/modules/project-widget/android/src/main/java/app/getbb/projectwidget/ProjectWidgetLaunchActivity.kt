package app.getbb.projectwidget

import android.app.Activity
import android.appwidget.AppWidgetManager
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import java.util.UUID

class ProjectWidgetLaunchActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val widgetId = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)
    val target = ProjectWidgetProvider.readTarget(this, widgetId)
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    if (target != null && launch != null) {
      val token = issue(target)
      launch.action = Intent.ACTION_VIEW
      launch.data = Uri.Builder().scheme("bb").authority("widget").appendPath("new-thread")
        .appendQueryParameter("launchToken", token).build()
      startActivity(launch)
    }
    finish()
  }

  companion object {
    private val pending = linkedMapOf<String, String>()

    @Synchronized
    private fun issue(target: String): String {
      val token = UUID.randomUUID().toString()
      if (pending.size >= 16) pending.remove(pending.keys.first())
      pending[token] = target
      return token
    }

    @Synchronized
    fun take(token: String): String? = pending.remove(token)
  }
}
