package app.getbb.projectwidget

import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ProjectWidgetModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BBProjectWidget")

    AsyncFunction("configure") { widgetId: Int, profileId: String, projectId: String, name: String ->
      val activity = appContext.currentActivity as? ProjectWidgetActivity
      checkNotNull(activity).configure(widgetId, profileId, projectId, name)
    }.runOnQueue(Queues.MAIN)
  }
}
