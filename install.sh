#!/bin/sh
# Link zlides into the personal TeX tree and put the zlides command on PATH.
# Idempotent; pass --uninstall to remove the links.
set -eu
repo=$(cd "$(dirname "$0")" && pwd -P)
texmfhome=$(kpsewhich -var-value TEXMFHOME)
bindir=${ZLIDES_BINDIR:-$HOME/.local/bin}
sty_link="$texmfhome/tex/latex/zlides"
scripts_link="$texmfhome/scripts/zlides"
bin_link="$bindir/zlides"

if [ "${1:-}" = "--uninstall" ]; then
  for link in "$sty_link" "$scripts_link" "$bin_link"; do
    if [ -L "$link" ]; then
      rm "$link" && echo "unlinked $link"
    else
      echo "nothing to remove at $link"
    fi
  done
  exit 0
fi

mkdir -p "$(dirname "$sty_link")" "$(dirname "$scripts_link")" "$bindir"
ln -sfn "$repo/tex/latex/zlides" "$sty_link"
ln -sfn "$repo/scripts/zlides" "$scripts_link"
ln -sf "$repo/scripts/zlides/zlides.lua" "$bin_link"

echo "linked $sty_link -> $repo/tex/latex/zlides"
echo "linked $scripts_link -> $repo/scripts/zlides"
echo "linked $bin_link -> $repo/scripts/zlides/zlides.lua"
case ":$PATH:" in
  *":$bindir:"*) ;;
  *) echo "Add $bindir to PATH to run zlides." ;;
esac
