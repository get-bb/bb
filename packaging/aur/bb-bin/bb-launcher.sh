#!/bin/sh

prefix=/opt/bb
unset APPIMAGE APPDIR
export PATH="$prefix:$prefix/usr/sbin${PATH:+:$PATH}"
export LD_LIBRARY_PATH="$prefix/usr/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export GSETTINGS_SCHEMA_DIR="$prefix/usr/share/glib-2.0/schemas${GSETTINGS_SCHEMA_DIR:+:$GSETTINGS_SCHEMA_DIR}"
if [ -n "${XDG_DATA_DIRS:-}" ]; then
  export XDG_DATA_DIRS="$prefix/usr/share:$XDG_DATA_DIRS"
else
  export XDG_DATA_DIRS="$prefix/usr/share:/usr/local/share:/usr/share"
fi
exec "$prefix/bb" "$@"
