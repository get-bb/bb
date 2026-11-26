package app.getbb.mobile.clientcertificates

import java.net.URI
import java.util.Locale

internal data class ServerKey(val host: String, val port: Int) {
  val storageKey: String
    get() = "$host:$port"

  val uri: String
    get() = if (host.contains(':')) "https://[$host]:$port" else "https://$host:$port"

  companion object {
    private const val HTTPS_PORT = 443

    fun of(host: String, port: Int): ServerKey? {
      val normalized = host.trim().removePrefix("[").removeSuffix("]").lowercase(Locale.ROOT)
      if (normalized.isEmpty()) return null
      return ServerKey(normalized, if (port in 1..65535) port else HTTPS_PORT)
    }

    fun fromServerUrl(serverUrl: String): ServerKey? {
      val uri = runCatching { URI(serverUrl.trim()) }.getOrNull() ?: return null
      if (!uri.scheme.equals("https", ignoreCase = true)) return null
      return of(uri.host ?: return null, uri.port)
    }
  }
}
