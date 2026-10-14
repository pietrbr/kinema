#!/bin/sh
# Link kinema into the personal TeX tree and put the kinema command on PATH.
# Idempotent; pass --uninstall to remove the links.
set -eu
repo=$(cd "$(dirname "$0")" && pwd -P)
texmfhome=$(kpsewhich -var-value TEXMFHOME)
bindir=${KINEMA_BINDIR:-$HOME/.local/bin}
sty_link="$texmfhome/tex/latex/kinema"
scripts_link="$texmfhome/scripts/kinema"
bin_link="$bindir/kinema"

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
ln -sfn "$repo/tex/latex/kinema" "$sty_link"
ln -sfn "$repo/scripts/kinema" "$scripts_link"
ln -sf "$repo/scripts/kinema/kinema.lua" "$bin_link"

echo "linked $sty_link -> $repo/tex/latex/kinema"
echo "linked $scripts_link -> $repo/scripts/kinema"
echo "linked $bin_link -> $repo/scripts/kinema/kinema.lua"
case ":$PATH:" in
*":$bindir:"*) ;;
*) echo "Add $bindir to PATH to run kinema." ;;
esac
