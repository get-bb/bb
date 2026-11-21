package app.getbb.mobile.clientcertificates

import android.app.Activity
import android.app.Application
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.security.KeyChain
import android.security.KeyChainException
import android.webkit.WebView
import com.facebook.react.modules.network.OkHttpClientProvider
import java.io.File
import java.io.IOException
import java.lang.ref.WeakReference
import java.net.InetSocketAddress
import java.net.Socket
import java.security.KeyStore
import java.util.concurrent.CompletableFuture
import javax.net.ssl.SSLContext
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory
import javax.net.ssl.TrustManagerFactory
import javax.net.ssl.X509TrustManager
import okhttp3.Cache
import okhttp3.ConnectionPool

internal object ClientCertificates {
  private const val PREFERENCES = "bb_client_certificates"
  private val KEY_CHAIN_KEY_TYPES = setOf("RSA", "EC")
  private const val PREPARE_CONNECT_TIMEOUT_MS = 8_000
  private const val HTTP_CACHE_DIRECTORY = "http-cache"
  private const val HTTP_CACHE_BYTES = 10L * 1024 * 1024

  private val mainHandler = Handler(Looper.getMainLooper())
  @Volatile private var resumedActivity: WeakReference<Activity>? = null
  private lateinit var appContext: Context
  lateinit var broker: ClientCertificateBroker
    private set
  private lateinit var trustManager: X509TrustManager
  private lateinit var socketFactory: SwitchableSSLSocketFactory
  private val connectionPool = ConnectionPool()

  fun install(application: Application) {
    appContext = application.applicationContext
    broker =
      ClientCertificateBroker(
        ClientCertificateChoices(appContext.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)),
        ::prompt,
        ::loadKeyMaterial,
      )
    application.registerActivityLifecycleCallbacks(ActivityTracker)
    trustManager = defaultTrustManager()
    socketFactory = SwitchableSSLSocketFactory(newSocketFactory())
    val cache = Cache(File(appContext.cacheDir, HTTP_CACHE_DIRECTORY), HTTP_CACHE_BYTES)
    OkHttpClientProvider.setOkHttpClientFactory {
      OkHttpClientProvider.createClientBuilder()
        .cache(cache)
        .connectionPool(connectionPool)
        .sslSocketFactory(socketFactory, trustManager)
        .build()
    }
    WebViewClientCertificates.install()
  }

  fun currentActivity(): Activity? = resumedActivity?.get()

  fun prepare(server: ServerKey) {
    if (broker.forgetDecline(server)) choiceChanged()
    try {
      Socket().use { raw ->
        raw.connect(InetSocketAddress(server.host, server.port), PREPARE_CONNECT_TIMEOUT_MS)
        (socketFactory.createSocket(raw, server.host, server.port, true) as SSLSocket).use { it.startHandshake() }
      }
    } catch (_: IOException) {
    }
  }

  fun restartApp() {
    val intent = appContext.packageManager.getLaunchIntentForPackage(appContext.packageName) ?: return
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
    appContext.startActivity(intent)
    Runtime.getRuntime().exit(0)
  }

  fun choiceChanged() {
    broker.clearCachedMaterial()
    connectionPool.evictAll()
    socketFactory.delegate = newSocketFactory()
    mainHandler.post { WebView.clearClientCertPreferences(null) }
  }

  private fun prompt(request: CertificateRequest, preselectedAlias: String?): CompletableFuture<String?>? {
    if (Looper.myLooper() == Looper.getMainLooper()) return null
    val activity = currentActivity() ?: return null
    val result = CompletableFuture<String?>()
    val keyTypes = request.keyTypes?.filter { it in KEY_CHAIN_KEY_TYPES }?.distinct()?.toTypedArray()
    mainHandler.post {
      try {
        KeyChain.choosePrivateKeyAlias(
          activity,
          { alias -> result.complete(alias) },
          keyTypes?.takeIf { it.isNotEmpty() },
          request.issuers?.takeIf { it.isNotEmpty() },
          Uri.parse(request.server.uri),
          preselectedAlias,
        )
      } catch (error: RuntimeException) {
        result.completeExceptionally(error)
      }
    }
    return result
  }

  private fun loadKeyMaterial(alias: String): KeyMaterial? =
    try {
      val privateKey = KeyChain.getPrivateKey(appContext, alias)
      val chain = KeyChain.getCertificateChain(appContext, alias)
      if (privateKey == null || chain.isNullOrEmpty()) null else KeyMaterial(privateKey, chain)
    } catch (_: KeyChainException) {
      null
    } catch (_: InterruptedException) {
      Thread.currentThread().interrupt()
      null
    }

  private fun newSocketFactory(): SSLSocketFactory =
    SSLContext.getInstance("TLS")
      .apply { init(arrayOf(ClientCertificateKeyManager { broker }), arrayOf(trustManager), null) }
      .socketFactory

  private fun defaultTrustManager(): X509TrustManager {
    val factory = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm())
    factory.init(null as KeyStore?)
    return factory.trustManagers.filterIsInstance<X509TrustManager>().single()
  }

  private object ActivityTracker : Application.ActivityLifecycleCallbacks {
    override fun onActivityResumed(activity: Activity) {
      resumedActivity = WeakReference(activity)
    }

    override fun onActivityPaused(activity: Activity) {
      if (resumedActivity?.get() === activity) resumedActivity = null
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit

    override fun onActivityStarted(activity: Activity) = Unit

    override fun onActivityStopped(activity: Activity) = Unit

    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit

    override fun onActivityDestroyed(activity: Activity) = Unit
  }
}
