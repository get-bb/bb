package app.getbb.mobile.clientcertificates

import android.os.Handler
import android.os.Looper
import android.webkit.ClientCertRequest
import android.webkit.WebView
import com.reactnativecommunity.webview.RNCWebViewClient
import java.util.concurrent.Executors

internal object WebViewClientCertificates : RNCWebViewClient.ClientCertRequestHandler {
  private val executor = Executors.newSingleThreadExecutor()
  private val mainHandler = Handler(Looper.getMainLooper())

  fun install() = RNCWebViewClient.setClientCertRequestHandler(this)

  override fun onReceivedClientCertRequest(view: WebView, request: ClientCertRequest) {
    val server = ServerKey.of(request.host, request.port)
    if (server == null) {
      request.ignore()
      return
    }
    executor.execute {
      val resolution =
        ClientCertificates.broker.resolve(CertificateRequest(server, request.keyTypes, request.principals))
      mainHandler.post {
        when (resolution) {
          is Resolution.Use -> request.proceed(resolution.material.privateKey, resolution.material.chain)
          is Resolution.NoCertificate -> if (resolution.remembered) request.cancel() else request.ignore()
        }
      }
    }
  }
}
