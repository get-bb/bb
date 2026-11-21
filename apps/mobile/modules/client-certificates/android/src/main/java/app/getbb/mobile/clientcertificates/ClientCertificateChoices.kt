package app.getbb.mobile.clientcertificates

import android.content.SharedPreferences

internal sealed interface ClientCertificateChoice {
  data object Unset : ClientCertificateChoice

  data object Declined : ClientCertificateChoice

  data class Alias(val alias: String) : ClientCertificateChoice
}

internal class ClientCertificateChoices(private val prefs: SharedPreferences) {
  fun get(server: ServerKey): ClientCertificateChoice {
    if (!prefs.contains(server.storageKey)) return ClientCertificateChoice.Unset
    val alias = prefs.getString(server.storageKey, null)
    return if (alias.isNullOrEmpty()) ClientCertificateChoice.Declined else ClientCertificateChoice.Alias(alias)
  }

  fun use(server: ServerKey, alias: String) {
    prefs.edit().putString(server.storageKey, alias).apply()
  }

  fun decline(server: ServerKey) {
    prefs.edit().putString(server.storageKey, DECLINED).apply()
  }

  fun forget(server: ServerKey) {
    prefs.edit().remove(server.storageKey).apply()
  }

  private companion object {
    const val DECLINED = ""
  }
}
