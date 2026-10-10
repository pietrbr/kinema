#!/bin/sh
# Link kinetic into the personal TeX tree and put the kinetic command on PATH.
# Idempotent; pass --uninstall to remove the links.
set -eu
repo=$(cd "$(dirname "$0")" && pwd -P)
texmfhome=$(kpsewhich -var-value TEXMFHOME)
bindir=${KINETIC_BINDIR:-$HOME/.local/bin}
sty_link="$texmfhome/tex/latex/kinetic"
scripts_link="$texmfhome/scripts/kinetic"
bin_link="$bindir/kinetic"

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
ln -sfn "$repo/tex/latex/kinetic" "$sty_link"
ln -sfn "$repo/scripts/kinetic" "$scripts_link"
ln -sf "$repo/scripts/kinetic/kinetic.lua" "$bin_link"

echo "linked $sty_link -> $repo/tex/latex/kinetic"
echo "linked $scripts_link -> $repo/scripts/kinetic"
echo "linked $bin_link -> $repo/scripts/kinetic/kinetic.lua"
case ":$PATH:" in
*":$bindir:"*) ;;
*) echo "Add $bindir to PATH to run kinetic." ;;
esac
