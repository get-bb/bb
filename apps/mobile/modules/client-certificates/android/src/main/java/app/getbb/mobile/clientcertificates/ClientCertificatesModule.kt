package app.getbb.mobile.clientcertificates

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ClientCertificatesModule : Module() {
  override fun definition() =
    ModuleDefinition {
      Name("BbClientCertificates")

      Function("getAlias") { serverUrl: String -> ClientCertificates.broker.currentAlias(server(serverUrl)) }

      AsyncFunction("prepare") { serverUrl: String ->
        ServerKey.fromServerUrl(serverUrl)?.let { ClientCertificates.prepare(it) }
        Unit
      }

      AsyncFunction("choose") { serverUrl: String ->
        val alias = ClientCertificates.broker.choose(server(serverUrl))
        if (alias != null) ClientCertificates.choiceChanged()
        alias
      }

      AsyncFunction("stopUsing") { serverUrl: String ->
        ClientCertificates.broker.stopUsing(server(serverUrl))
        ClientCertificates.choiceChanged()
      }

      Function("restartApp") { ClientCertificates.restartApp() }

      AsyncFunction("forget") { serverUrl: String ->
        ClientCertificates.broker.forget(server(serverUrl))
        ClientCertificates.choiceChanged()
      }
    }

  private fun server(serverUrl: String): ServerKey =
    ServerKey.fromServerUrl(serverUrl) ?: throw NotHttpsServerException(serverUrl)
}

private class NotHttpsServerException(serverUrl: String) :
  CodedException("ERR_NOT_HTTPS_SERVER", "Client certificates need an https:// server URL, not $serverUrl", null)
