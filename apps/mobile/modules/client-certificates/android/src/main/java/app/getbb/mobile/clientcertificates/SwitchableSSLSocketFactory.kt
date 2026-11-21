package app.getbb.mobile.clientcertificates

import java.net.InetAddress
import java.net.Socket
import javax.net.ssl.SSLSocketFactory

internal class SwitchableSSLSocketFactory(@Volatile var delegate: SSLSocketFactory) : SSLSocketFactory() {
  override fun getDefaultCipherSuites(): Array<String> = delegate.defaultCipherSuites

  override fun getSupportedCipherSuites(): Array<String> = delegate.supportedCipherSuites

  override fun createSocket(): Socket = delegate.createSocket()

  override fun createSocket(socket: Socket?, host: String?, port: Int, autoClose: Boolean): Socket =
    delegate.createSocket(socket, host, port, autoClose)

  override fun createSocket(host: String?, port: Int): Socket = delegate.createSocket(host, port)

  override fun createSocket(host: String?, port: Int, localHost: InetAddress?, localPort: Int): Socket =
    delegate.createSocket(host, port, localHost, localPort)

  override fun createSocket(host: InetAddress?, port: Int): Socket = delegate.createSocket(host, port)

  override fun createSocket(address: InetAddress?, port: Int, localAddress: InetAddress?, localPort: Int): Socket =
    delegate.createSocket(address, port, localAddress, localPort)
}
