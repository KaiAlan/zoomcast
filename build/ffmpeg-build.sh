#!/usr/bin/env bash
# All compilation and binary execution takes place natively on Windows/MSYS2.
set -euo pipefail
work="$(cygpath -u "$1")"
cd "$work"
mkdir -p extracted prefix
for name in ffmpeg x264 nv-codec-headers zlib; do
  if [[ ! -f "extracted/$name/configure" && ! -f "extracted/$name/ffnvcodec.pc.in" ]]; then
    mkdir -p "extracted/$name"
    tar -xzf "$name.tar.gz" --strip-components=1 -C "extracted/$name"
  fi
done
tar -xf nasm.pkg.tar.zst -C prefix
export PATH="$work/prefix/mingw64/bin:$PATH"
prefix="$work/prefix"
mkdir -p "$prefix/include" "$prefix/lib"
{
  gcc --version
  nasm -v
  make --version
  pkg-config --version
  pacman -Q
} > toolchain.txt
cd extracted/zlib
make -f win32/Makefile.gcc -j"${ZOOMCAST_BUILD_JOBS:-8}" libz.a
cp zlib.h zconf.h "$prefix/include/"
cp libz.a "$prefix/lib/"
cd ../x264
./configure --prefix="$prefix" --host=x86_64-w64-mingw32 --enable-static --disable-cli --disable-opencl
make -j"${ZOOMCAST_BUILD_JOBS:-8}"
make install
cd ../nv-codec-headers
make PREFIX="$prefix" install
mkdir -p "$prefix/include/AMF"
cp -r "$work/amf-headers/amf/public/include/"* "$prefix/include/AMF/"
cd ../ffmpeg
export PKG_CONFIG_PATH="$prefix/lib/pkgconfig"
./configure --prefix="$prefix" --arch=x86_64 --target-os=mingw32 \
  --enable-gpl --enable-zlib --enable-d3d11va --enable-dxva2 --enable-libx264 \
  --enable-amf --enable-ffnvcodec --enable-nvenc \
  --disable-ffplay --disable-doc --disable-debug --disable-autodetect \
  --extra-cflags="-I$prefix/include" --extra-ldflags="-L$prefix/lib -static" \
  --pkg-config-flags=--static
make -j"${ZOOMCAST_BUILD_JOBS:-8}" ffmpeg.exe ffprobe.exe
cp ffmpeg.exe ffprobe.exe "$prefix/"
