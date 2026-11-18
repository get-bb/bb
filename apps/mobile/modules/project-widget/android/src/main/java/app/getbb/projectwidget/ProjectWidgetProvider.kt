package app.getbb.projectwidget

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import org.json.JSONObject

class ProjectWidgetProvider : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    for (id in ids) {
      val target = readTarget(context, id) ?: continue
      update(context, manager, id, JSONObject(target))
    }
  }

  override fun onDeleted(context: Context, ids: IntArray) {
    val edits = preferences(context).edit()
    for (id in ids) edits.remove(id.toString())
    edits.apply()
  }

  companion object {
    private fun preferences(context: Context) =
      context.getSharedPreferences("bb.projectWidgets", Context.MODE_PRIVATE)

    fun readTarget(context: Context, id: Int): String? = preferences(context).getString(id.toString(), null)

    fun configure(context: Context, id: Int, targetJson: String) {
      val target = JSONObject(targetJson)
      require(target.getString("profileId").isNotBlank() && target.getString("projectId").isNotBlank())
      require(target.getString("projectName").isNotBlank() && target.getString("action") in setOf("photo", "thread", "voice"))
      icon(target.getString("icon"))
      check(preferences(context).edit().putString(id.toString(), targetJson).commit())
      update(context, AppWidgetManager.getInstance(context), id, target)
    }

    private fun icon(name: String): Int = when (name) {
      "message" -> R.drawable.bb_widget_icon_message
      "camera" -> R.drawable.bb_widget_icon_camera
      "microphone" -> R.drawable.bb_widget_icon_microphone
      "code" -> R.drawable.bb_widget_icon_code
      "terminal" -> R.drawable.bb_widget_icon_terminal
      "check" -> R.drawable.bb_widget_icon_check
      "star" -> R.drawable.bb_widget_icon_star
      else -> error("Unknown widget icon")
    }

    private fun update(context: Context, manager: AppWidgetManager, id: Int, target: JSONObject) {
      val name = target.getString("projectName")
      val action = when (target.getString("action")) {
        "photo" -> R.string.bb_project_widget_photo
        "voice" -> R.string.bb_project_widget_voice
        else -> R.string.bb_project_widget_label
      }
      val launch = Intent(context, ProjectWidgetLaunchActivity::class.java)
        .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
      val tap = PendingIntent.getActivity(context, id, launch, PendingIntent.FLAG_IMMUTABLE)
      val views = RemoteViews(context.packageName, R.layout.bb_project_widget)
      views.setImageViewResource(R.id.bb_project_widget_icon, icon(target.getString("icon")))
      views.setTextViewText(R.id.bb_project_widget_label, name)
      views.setContentDescription(R.id.bb_project_widget, context.getString(action, name))
      views.setOnClickPendingIntent(R.id.bb_project_widget, tap)
      manager.updateAppWidget(id, views)
    }
  }
}
