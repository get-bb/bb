package app.getbb.mobile.clientcertificates

import java.net.InetSocketAddress
import java.net.Socket
import java.security.Principal
import java.security.PrivateKey
import java.security.cert.X509Certificate
import javax.net.ssl.SSLEngine
import javax.net.ssl.SSLSocket
import javax.net.ssl.X509ExtendedKeyManager

internal class ClientCertificateKeyManager(private val broker: () -> ClientCertificateBroker) :
  X509ExtendedKeyManager() {
  override fun chooseClientAlias(keyType: Array<String>?, issuers: Array<Principal>?, socket: Socket?): String? {
    val session = (socket as? SSLSocket)?.handshakeSession
    val remote = socket?.remoteSocketAddress as? InetSocketAddress
    val host = session?.peerHost ?: remote?.hostString ?: return null
    val port = session?.peerPort?.takeIf { it > 0 } ?: remote?.port ?: return null
    return choose(ServerKey.of(host, port), keyType, issuers)
  }

  override fun chooseEngineClientAlias(keyType: Array<String>?, issuers: Array<Principal>?, engine: SSLEngine?): String? {
    val host = engine?.peerHost ?: return null
    return choose(ServerKey.of(host, engine.peerPort), keyType, issuers)
  }

  private fun choose(server: ServerKey?, keyTypes: Array<String>?, issuers: Array<Principal>?): String? {
    server ?: return null
    return (broker().resolve(CertificateRequest(server, keyTypes, issuers)) as? Resolution.Use)?.alias
  }

  override fun getCertificateChain(alias: String?): Array<X509Certificate>? =
    alias?.let { broker().cachedMaterial(it)?.chain }

  override fun getPrivateKey(alias: String?): PrivateKey? =
    alias?.let { broker().cachedMaterial(it)?.privateKey }

  override fun getClientAliases(keyType: String?, issuers: Array<Principal>?): Array<String>? = null

  override fun getServerAliases(keyType: String?, issuers: Array<Principal>?): Array<String>? = null

  override fun chooseServerAlias(keyType: String?, issuers: Array<Principal>?, socket: Socket?): String? = null
}
