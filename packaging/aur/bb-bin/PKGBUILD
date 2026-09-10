# Maintainer: James LeBaron <jimmleb178@gmail.com>

pkgname=bb-bin
pkgver=0.42.1
pkgrel=2
pkgdesc="Agentic IDE that builds itself"
arch=('x86_64')
url='https://github.com/get-bb/bb'
license=('MIT')
provides=('bb')
conflicts=('bb')
options=(!strip !debug)
source=(
  "$pkgname-$pkgver.AppImage::https://github.com/get-bb/bb/releases/download/desktop-v$pkgver/bb-$pkgver-x86_64.AppImage"
  'bb-launcher.sh'
  'LICENSE'
)
noextract=("$pkgname-$pkgver.AppImage")
sha256sums=('b29165f5cd2f06feeba51c36ca86b96006bfc6c48521903367c004ae63c86976'
            '67d10f7a6daac6bfbd947bbc2af59bcc42589d5e37637a504ffce9c89074d173'
            'd10816aa30183af920bdd789a81b16847bcf3e287e1b3419dd7d85f6e3e8e7b0')

prepare() {
  chmod +x "$srcdir/$pkgname-$pkgver.AppImage"
  "$srcdir/$pkgname-$pkgver.AppImage" --appimage-extract
}

package() {
  install -dm755 "$pkgdir/opt/bb"
  cp -a --no-preserve=ownership "$srcdir/squashfs-root/." "$pkgdir/opt/bb/"
  install -Dm755 "$srcdir/bb-launcher.sh" "$pkgdir/usr/bin/bb"

  install -Dm644 "$srcdir/squashfs-root/bb.desktop" \
    "$pkgdir/usr/share/applications/bb.desktop"
  sed -i 's|^Exec=AppRun|Exec=bb|' "$pkgdir/usr/share/applications/bb.desktop"
  install -Dm644 "$srcdir/squashfs-root/usr/share/icons/hicolor/1024x1024/apps/bb.png" \
    "$pkgdir/usr/share/icons/hicolor/1024x1024/apps/bb.png"
  install -Dm644 "$srcdir/LICENSE" "$pkgdir/usr/share/licenses/$pkgname/LICENSE"
}
