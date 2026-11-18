package app.getbb.projectwidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews

class ProjectWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) update(context, manager, id)
  }

  override fun onDeleted(context: Context, ids: IntArray) {
    val edits = preferences(context).edit()
    for (id in ids) {
      edits.remove("$id.link").remove("$id.name")
    }
    edits.apply()
  }

  companion object {
    private fun preferences(context: Context) =
      context.getSharedPreferences("bb.projectWidgets", Context.MODE_PRIVATE)

    fun isConfigured(context: Context, id: Int) = preferences(context).contains("$id.link")

    fun configure(context: Context, id: Int, profileId: String, projectId: String, name: String) {
      val link = Uri.Builder().scheme("bb").authority("widget").appendPath("new-thread")
        .appendQueryParameter("profileId", profileId)
        .appendQueryParameter("projectId", projectId)
        .build()
      check(preferences(context).edit().putString("$id.link", link.toString())
        .putString("$id.name", name).commit())
      update(context, AppWidgetManager.getInstance(context), id)
    }

    private fun update(context: Context, manager: AppWidgetManager, id: Int) {
      val prefs = preferences(context)
      val link = prefs.getString("$id.link", null) ?: return
      val name = prefs.getString("$id.name", null) ?: return
      val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
      launch.action = Intent.ACTION_VIEW
      launch.data = Uri.parse(link)
      val tap = PendingIntent.getActivity(context, id, launch, PendingIntent.FLAG_IMMUTABLE)
      val views = RemoteViews(context.packageName, R.layout.bb_project_widget)
      views.setTextViewText(R.id.bb_project_widget_label, context.getString(R.string.bb_project_widget_label, name))
      views.setOnClickPendingIntent(R.id.bb_project_widget_label, tap)
      manager.updateAppWidget(id, views)
    }
  }
}
