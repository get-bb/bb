package app.getbb.projectwidget

import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ProjectWidgetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BBProjectWidget")

    AsyncFunction("takeLaunch") { token: String -> ProjectWidgetLaunchActivity.take(token) }

    AsyncFunction("configure") { widgetId: Int, targetJson: String ->
      val activity = appContext.currentActivity as? ProjectWidgetActivity
      checkNotNull(activity).configure(widgetId, targetJson)
    }.runOnQueue(Queues.MAIN)

    View(ProjectWidgetIconPreview::class) {
      Prop("icon") { view: ProjectWidgetIconPreview, icon: String ->
        view.setIcon(icon)
      }
      Prop("projectName") { view: ProjectWidgetIconPreview, projectName: String ->
        view.setProjectName(projectName)
      }
    }
  }
}
