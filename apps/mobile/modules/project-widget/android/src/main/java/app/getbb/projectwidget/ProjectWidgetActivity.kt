package app.getbb.projectwidget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Intent
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultReactActivityDelegate

class ProjectWidgetActivity : ReactActivity() {
  private val widgetId: Int
    get() = intent.getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, AppWidgetManager.INVALID_APPWIDGET_ID)

  override fun getMainComponentName() = "BBProjectWidgetConfiguration"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
    object : DefaultReactActivityDelegate(this, mainComponentName) {
      override fun getLaunchOptions() = Bundle().apply { putInt("widgetId", widgetId) }
    }

  override fun onCreate(savedInstanceState: Bundle?) {
    val valid = canConfigure()
    if (!valid) {
      finish()
    } else {
      setResult(RESULT_CANCELED, resultIntent())
    }
    super.onCreate(null)
  }

  fun configure(id: Int, targetJson: String) {
    check(!isFinishing && id == widgetId && canConfigure())
    ProjectWidgetProvider.configure(this, widgetId, targetJson)
    setResult(RESULT_OK, resultIntent())
    finish()
  }

  private fun canConfigure(): Boolean {
    if (intent.action != AppWidgetManager.ACTION_APPWIDGET_CONFIGURE) return false
    val provider = AppWidgetManager.getInstance(this).getAppWidgetInfo(widgetId)?.provider
    return provider == ComponentName(this, ProjectWidgetProvider::class.java) &&
      ProjectWidgetProvider.readTarget(this, widgetId) == null
  }

  private fun resultIntent() = Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, widgetId)
}
