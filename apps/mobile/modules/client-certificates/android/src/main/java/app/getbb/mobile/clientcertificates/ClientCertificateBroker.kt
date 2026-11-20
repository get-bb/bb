package app.getbb.mobile.clientcertificates

import java.security.Principal
import java.security.PrivateKey
import java.security.cert.X509Certificate
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

internal class KeyMaterial(val privateKey: PrivateKey, val chain: Array<X509Certificate>)

internal class CertificateRequest(
  val server: ServerKey,
  val keyTypes: Array<String>?,
  val issuers: Array<Principal>?,
)

internal fun interface AliasPrompter {
  fun prompt(request: CertificateRequest, preselectedAlias: String?): CompletableFuture<String?>?
}

internal fun interface KeyMaterialSource {
  fun load(alias: String): KeyMaterial?
}

internal sealed interface Resolution {
  data class Use(val alias: String, val material: KeyMaterial) : Resolution

  data class NoCertificate(val remembered: Boolean) : Resolution
}

internal class ClientCertificateBroker(
  private val choices: ClientCertificateChoices,
  private val prompter: AliasPrompter,
  private val keys: KeyMaterialSource,
  private val promptTimeoutMillis: Long = TimeUnit.MINUTES.toMillis(5),
) {
  private val prompts = ConcurrentHashMap<ServerKey, CompletableFuture<String?>>()
  private val materials = ConcurrentHashMap<String, KeyMaterial>()

  fun resolve(request: CertificateRequest): Resolution =
    when (val choice = choices.get(request.server)) {
      ClientCertificateChoice.Declined -> Resolution.NoCertificate(remembered = true)
      is ClientCertificateChoice.Alias ->
        material(choice.alias)?.let { Resolution.Use(choice.alias, it) }
          ?: run {
            choices.forget(request.server)
            promptAndRemember(request, preselectedAlias = choice.alias)
          }
      ClientCertificateChoice.Unset -> promptAndRemember(request, preselectedAlias = null)
    }

  fun choose(server: ServerKey): String? {
    val current = (choices.get(server) as? ClientCertificateChoice.Alias)?.alias
    val outcome =
      awaitPrompt(CertificateRequest(server, null, null), current) { alias ->
        if (alias != null && material(alias) != null) choices.use(server, alias)
      }
    val alias = (outcome as? PromptOutcome.Answered)?.alias ?: return null
    return alias.takeIf { currentAlias(server) == it }
  }

  fun currentAlias(server: ServerKey): String? =
    (choices.get(server) as? ClientCertificateChoice.Alias)?.alias

  fun stopUsing(server: ServerKey) = choices.decline(server)

  fun forget(server: ServerKey) = choices.forget(server)

  fun forgetDecline(server: ServerKey): Boolean {
    if (choices.get(server) != ClientCertificateChoice.Declined) return false
    choices.forget(server)
    return true
  }

  fun cachedMaterial(alias: String): KeyMaterial? = materials[alias]

  fun clearCachedMaterial() = materials.clear()

  private fun material(alias: String): KeyMaterial? =
    materials[alias] ?: keys.load(alias)?.also { materials[alias] = it }

  private fun promptAndRemember(request: CertificateRequest, preselectedAlias: String?): Resolution {
    val outcome =
      awaitPrompt(request, preselectedAlias) { alias ->
        when {
          alias == null -> choices.decline(request.server)
          material(alias) != null -> choices.use(request.server, alias)
        }
      }
    if (outcome !is PromptOutcome.Answered) return Resolution.NoCertificate(remembered = false)
    val alias = outcome.alias ?: return Resolution.NoCertificate(remembered = true)
    val material = material(alias) ?: return Resolution.NoCertificate(remembered = false)
    return Resolution.Use(alias, material)
  }

  private fun awaitPrompt(
    request: CertificateRequest,
    preselectedAlias: String?,
    remember: (String?) -> Unit,
  ): PromptOutcome {
    var started: CompletableFuture<String?>? = null
    val future =
      prompts.computeIfAbsent(request.server) {
        prompter.prompt(request, preselectedAlias)?.also { started = it } ?: NO_PROMPT
      }
    if (future === NO_PROMPT) {
      prompts.remove(request.server, NO_PROMPT)
      return PromptOutcome.Unavailable
    }
    return try {
      val alias = future.get(promptTimeoutMillis, TimeUnit.MILLISECONDS)
      if (started != null) remember(alias)
      PromptOutcome.Answered(alias)
    } catch (_: TimeoutException) {
      PromptOutcome.Unavailable
    } catch (_: ExecutionException) {
      PromptOutcome.Unavailable
    } catch (_: InterruptedException) {
      Thread.currentThread().interrupt()
      PromptOutcome.Unavailable
    } finally {
      started?.let { prompts.remove(request.server, it) }
    }
  }

  private sealed interface PromptOutcome {
    data class Answered(val alias: String?) : PromptOutcome

    data object Unavailable : PromptOutcome
  }

  private companion object {
    val NO_PROMPT = CompletableFuture<String?>()
  }
}
