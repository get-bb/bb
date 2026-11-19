package app.getbb.projectwidget

import android.content.Context
import android.widget.ImageView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

class ProjectWidgetIconPreview(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true

  private val image = ImageView(context).apply {
    scaleType = ImageView.ScaleType.CENTER
    setImageResource(R.drawable.bb_widget_icon_message)
  }

  init {
    setBackgroundResource(R.drawable.bb_project_widget_background)
    addView(image, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
  }

  fun setIcon(icon: String) {
    image.setImageResource(ProjectWidgetProvider.icon(icon))
  }
}
