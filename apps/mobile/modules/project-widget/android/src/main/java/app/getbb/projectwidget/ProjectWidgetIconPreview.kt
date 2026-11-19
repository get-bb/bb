package app.getbb.projectwidget

import android.content.Context
import android.view.LayoutInflater
import android.widget.ImageView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

class ProjectWidgetIconPreview(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true

  private val widget = LayoutInflater.from(context).inflate(R.layout.bb_project_widget, this, false)
  private val image = widget.findViewById<ImageView>(R.id.bb_project_widget_icon)

  init {
    addView(widget)
  }

  fun setIcon(icon: String) {
    image.setImageResource(ProjectWidgetProvider.icon(icon))
  }
}
