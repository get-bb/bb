package app.getbb.mobile.clientcertificates

import java.security.PrivateKey
import java.security.cert.X509Certificate
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ClientCertificateBrokerTest {
  private val server = ServerKey.of("bb.example.com", 443)!!
  private val request = CertificateRequest(server, arrayOf("EC"), null)

  private class FakePrompter(var answer: () -> CompletableFuture<String?>?) : AliasPrompter {
    val prompts = AtomicInteger()
    val preselected = mutableListOf<String?>()

    override fun prompt(request: CertificateRequest, preselectedAlias: String?): CompletableFuture<String?>? {
      prompts.incrementAndGet()
      preselected += preselectedAlias
      return answer()
    }
  }

  private class FakeKeys(vararg aliases: String) : KeyMaterialSource {
    val available = aliases.toMutableSet()

    override fun load(alias: String): KeyMaterial? =
      if (alias in available) KeyMaterial(FakeKey, emptyArray<X509Certificate>()) else null
  }

  private object FakeKey : PrivateKey {
    override fun getAlgorithm() = "EC"

    override fun getFormat() = "PKCS#8"

    override fun getEncoded() = ByteArray(0)
  }

  private fun answered(alias: String?) = { CompletableFuture.completedFuture(alias) }

  @Test
  fun promptsOnceAndRemembersTheChosenCertificate() {
    val prompter = FakePrompter(answered("phone"))
    val choices = ClientCertificateChoices(MemoryPreferences())
    val broker = ClientCertificateBroker(choices, prompter, FakeKeys("phone"))

    assertEquals("phone", (broker.resolve(request) as Resolution.Use).alias)
    assertEquals("phone", (broker.resolve(request) as Resolution.Use).alias)
    assertEquals(1, prompter.prompts.get())
    assertEquals("phone", broker.currentAlias(server))
  }

  @Test
  fun remembersADeclinedPromptAndDoesNotAskAgain() {
    val prompter = FakePrompter(answered(null))
    val broker = ClientCertificateBroker(ClientCertificateChoices(MemoryPreferences()), prompter, FakeKeys())

    assertEquals(Resolution.NoCertificate(remembered = true), broker.resolve(request))
    assertEquals(Resolution.NoCertificate(remembered = true), broker.resolve(request))
    assertEquals(1, prompter.prompts.get())
  }

  @Test
  fun asksAgainLaterWhenNoScreenCouldShowThePicker() {
    val prompter = FakePrompter { null }
    val broker = ClientCertificateBroker(ClientCertificateChoices(MemoryPreferences()), prompter, FakeKeys("phone"))

    assertEquals(Resolution.NoCertificate(remembered = false), broker.resolve(request))

    prompter.answer = answered("phone")
    assertEquals("phone", (broker.resolve(request) as Resolution.Use).alias)
    assertEquals(2, prompter.prompts.get())
  }

  @Test
  fun asksAgainWhenTheSavedCertificateIsGone() {
    val prompter = FakePrompter(answered("phone"))
    val keys = FakeKeys("phone")
    val broker = ClientCertificateBroker(ClientCertificateChoices(MemoryPreferences()), prompter, keys)
    broker.resolve(request)
    broker.clearCachedMaterial()
    keys.available.clear()
    keys.available += "renewed"
    prompter.answer = answered("renewed")

    assertEquals("renewed", (broker.resolve(request) as Resolution.Use).alias)
    assertEquals(listOf(null, "phone"), prompter.preselected)
  }

  @Test
  fun concurrentHandshakesShareOnePicker() {
    val picker = CompletableFuture<String?>()
    val prompter = FakePrompter { picker }
    val broker = ClientCertificateBroker(ClientCertificateChoices(MemoryPreferences()), prompter, FakeKeys("phone"))
    val pool = Executors.newFixedThreadPool(4)
    val started = CountDownLatch(4)
    val results =
      (1..4).map {
        pool.submit<Resolution> {
          started.countDown()
          broker.resolve(request)
        }
      }
    started.await(5, TimeUnit.SECONDS)
    Thread.sleep(100)
    picker.complete("phone")

    results.forEach { assertEquals("phone", (it.get(5, TimeUnit.SECONDS) as Resolution.Use).alias) }
    assertEquals(1, prompter.prompts.get())
    pool.shutdown()
  }

  @Test
  fun choosingFromSettingsKeepsTheCurrentCertificateWhenCancelled() {
    val prompter = FakePrompter(answered("phone"))
    val broker = ClientCertificateBroker(ClientCertificateChoices(MemoryPreferences()), prompter, FakeKeys("phone"))
    assertEquals("phone", broker.choose(server))

    prompter.answer = answered(null)
    assertNull(broker.choose(server))
    assertEquals("phone", broker.currentAlias(server))
    assertEquals(listOf(null, "phone"), prompter.preselected)
  }

  @Test
  fun stopUsingDeclinesWithoutAPrompt() {
    val prompter = FakePrompter(answered("phone"))
    val broker = ClientCertificateBroker(ClientCertificateChoices(MemoryPreferences()), prompter, FakeKeys("phone"))
    broker.choose(server)
    broker.stopUsing(server)

    assertEquals(Resolution.NoCertificate(remembered = true), broker.resolve(request))
    assertEquals(1, prompter.prompts.get())
  }

  @Test
  fun forgettingADeclineAsksAgainButKeepsAChosenCertificate() {
    val prompter = FakePrompter(answered(null))
    val broker = ClientCertificateBroker(ClientCertificateChoices(MemoryPreferences()), prompter, FakeKeys("phone"))
    broker.resolve(request)
    assertTrue(broker.forgetDecline(server))
    prompter.answer = answered("phone")
    assertEquals("phone", (broker.resolve(request) as Resolution.Use).alias)

    assertFalse(broker.forgetDecline(server))
    assertEquals("phone", broker.currentAlias(server))
    assertEquals(2, prompter.prompts.get())
  }

  @Test
  fun keysServersByHostAndPort() {
    assertEquals("bb.example.com:443", ServerKey.fromServerUrl("https://BB.example.com/")!!.storageKey)
    assertEquals("bb.example.com:8443", ServerKey.fromServerUrl("https://bb.example.com:8443/x")!!.storageKey)
    assertEquals("::1:443", ServerKey.fromServerUrl("https://[::1]")!!.storageKey)
    assertEquals(ServerKey.of("bb.example.com", -1), ServerKey.of("BB.EXAMPLE.COM", 443))
    assertNull(ServerKey.fromServerUrl("http://bb.example.com"))
    assertTrue(ServerKey.of("::1", 443)!!.uri == "https://[::1]:443")
  }
}
