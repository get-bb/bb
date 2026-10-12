/* A connection-local watchdog uses SQLite's supported, thread-safe interrupt API.
 * better-sqlite3 builds with SQLITE_OMIT_PROGRESS_CALLBACK, so a progress handler
 * is unavailable. This timer runs independently of both Node event loops. */
#define _POSIX_C_SOURCE 200809L
#include "sqlite3ext.h"
#include <pthread.h>
#include <time.h>
SQLITE_EXTENSION_INIT1

typedef struct {
  sqlite3 *db;
  pthread_mutex_t mutex;
  pthread_cond_t wake;
  pthread_t timer;
  sqlite3_int64 until_ns;
  int stopped;
} Deadline;

static sqlite3_int64 monotonic_ns(void) {
  struct timespec now;
  if (clock_gettime(CLOCK_MONOTONIC, &now) != 0) return -1;
  return (sqlite3_int64)now.tv_sec * 1000000000 + now.tv_nsec;
}

static void *watch_deadline(void *context) {
  Deadline *deadline = context;
  pthread_mutex_lock(&deadline->mutex);
  while (!deadline->stopped) {
    if (deadline->until_ns == 0) {
      pthread_cond_wait(&deadline->wake, &deadline->mutex);
      continue;
    }
    sqlite3_int64 now_ns = monotonic_ns();
    sqlite3_int64 remaining = now_ns < 0 ? 0 : deadline->until_ns - now_ns;
    if (remaining <= 0) {
      /* SQLite explicitly supports interrupt from a different thread. Holding
       * the mutex prevents disarm/destruction from racing this call. */
      sqlite3_interrupt(deadline->db);
      deadline->until_ns = 0;
      continue;
    }
    struct timespec until;
#ifdef __APPLE__
    until.tv_sec = remaining / 1000000000;
    until.tv_nsec = remaining % 1000000000;
    pthread_cond_timedwait_relative_np(&deadline->wake, &deadline->mutex, &until);
#else
    until.tv_sec = deadline->until_ns / 1000000000;
    until.tv_nsec = deadline->until_ns % 1000000000;
    pthread_cond_timedwait(&deadline->wake, &deadline->mutex, &until);
#endif
  }
  pthread_mutex_unlock(&deadline->mutex);
  return 0;
}

static void set_deadline(sqlite3_context *context, int argc, sqlite3_value **argv) {
  (void)argc;
  Deadline *deadline = sqlite3_user_data(context);
  sqlite3_int64 budget_ms = sqlite3_value_int64(argv[0]);
  pthread_mutex_lock(&deadline->mutex);
  deadline->until_ns = budget_ms > 0 ? monotonic_ns() + budget_ms * 1000000 : 0;
  pthread_cond_signal(&deadline->wake);
  pthread_mutex_unlock(&deadline->mutex);
  sqlite3_result_null(context);
}

static void destroy_deadline(void *context) {
  Deadline *deadline = context;
  pthread_mutex_lock(&deadline->mutex);
  deadline->stopped = 1;
  pthread_cond_signal(&deadline->wake);
  pthread_mutex_unlock(&deadline->mutex);
  pthread_join(deadline->timer, 0);
  pthread_cond_destroy(&deadline->wake);
  pthread_mutex_destroy(&deadline->mutex);
  sqlite3_free(deadline);
}

int sqlite3_extension_init(sqlite3 *db, char **error,
                          const sqlite3_api_routines *api) {
  (void)error;
  SQLITE_EXTENSION_INIT2(api);
  if (!sqlite3_api->interruptx || monotonic_ns() < 0) return SQLITE_ERROR;
  Deadline *deadline = sqlite3_malloc(sizeof(*deadline));
  if (!deadline) return SQLITE_NOMEM;
  deadline->db = db;
  deadline->until_ns = 0;
  deadline->stopped = 0;
  if (pthread_mutex_init(&deadline->mutex, 0) != 0) {
    sqlite3_free(deadline);
    return SQLITE_ERROR;
  }
  pthread_condattr_t attributes;
  if (pthread_condattr_init(&attributes) != 0) {
    pthread_mutex_destroy(&deadline->mutex);
    sqlite3_free(deadline);
    return SQLITE_ERROR;
  }
#ifndef __APPLE__
  if (pthread_condattr_setclock(&attributes, CLOCK_MONOTONIC) != 0) {
    pthread_condattr_destroy(&attributes);
    pthread_mutex_destroy(&deadline->mutex);
    sqlite3_free(deadline);
    return SQLITE_ERROR;
  }
#endif
  int result = pthread_cond_init(&deadline->wake, &attributes);
  pthread_condattr_destroy(&attributes);
  if (result != 0) {
    pthread_mutex_destroy(&deadline->mutex);
    sqlite3_free(deadline);
    return SQLITE_ERROR;
  }
  if (pthread_create(&deadline->timer, 0, watch_deadline, deadline) != 0) {
    pthread_cond_destroy(&deadline->wake);
    pthread_mutex_destroy(&deadline->mutex);
    sqlite3_free(deadline);
    return SQLITE_ERROR;
  }
  /* SQLite also calls this destructor if registration fails. It joins the
   * watchdog before the connection can finish closing. */
  return sqlite3_create_function_v2(db, "bb_query_deadline", 1,
      SQLITE_UTF8 | SQLITE_DIRECTONLY, deadline, set_deadline, 0, 0,
      destroy_deadline);
}
