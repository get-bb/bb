package app.getbb.mobile.clientcertificates

import android.content.SharedPreferences

internal class MemoryPreferences : SharedPreferences {
  private val values = mutableMapOf<String, Any?>()

  override fun getAll(): Map<String, *> = values.toMap()

  override fun getString(key: String, defValue: String?): String? = values[key] as String? ?: defValue

  override fun getStringSet(key: String, defValues: Set<String>?): Set<String>? = defValues

  override fun getInt(key: String, defValue: Int): Int = defValue

  override fun getLong(key: String, defValue: Long): Long = defValue

  override fun getFloat(key: String, defValue: Float): Float = defValue

  override fun getBoolean(key: String, defValue: Boolean): Boolean = defValue

  override fun contains(key: String): Boolean = values.containsKey(key)

  override fun edit(): SharedPreferences.Editor = Editor()

  override fun registerOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) =
    Unit

  override fun unregisterOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) =
    Unit

  private inner class Editor : SharedPreferences.Editor {
    private val changes = mutableListOf<(MutableMap<String, Any?>) -> Unit>()

    override fun putString(key: String, value: String?) = apply { changes += { it[key] = value } }

    override fun putStringSet(key: String, values: Set<String>?) = apply { changes += { it[key] = values } }

    override fun putInt(key: String, value: Int) = apply { changes += { it[key] = value } }

    override fun putLong(key: String, value: Long) = apply { changes += { it[key] = value } }

    override fun putFloat(key: String, value: Float) = apply { changes += { it[key] = value } }

    override fun putBoolean(key: String, value: Boolean) = apply { changes += { it[key] = value } }

    override fun remove(key: String) = apply { changes += { it.remove(key) } }

    override fun clear() = apply { changes += { it.clear() } }

    override fun commit(): Boolean {
      apply()
      return true
    }

    override fun apply() = synchronized(values) { changes.forEach { it(values) } }
  }
}
