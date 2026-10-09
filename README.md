# zlides

zlides adds motion to Beamer slides. You give a name to a TikZ scope in your `.tex` file. The PDF build ignores the names and gives the usual overlays. The `zlides` command builds one HTML file, and the browser animates the named shapes from one page to the next.

The animations are morph, move, camera zoom, fade, and draw-on. A staged morph zooms into one block of a diagram. Frames can enter with a push or a fade. The HTML file contains all pages, images, and code, so it works offline in any current browser.

To see each feature, open `examples/showcase.html`. Its source is `examples/showcase.tex`, and its PDF build is `examples/showcase.pdf`.

## Quick start

1. Install the package and the `zlides` command. The script links them into your TeX tree and into `~/.local/bin`:

   ```sh
   ./install.sh
   ```

2. Load the package and name the shapes to animate:

   ```latex
   \documentclass{beamer}
   \usepackage{zlides}
   ...
   \only<1>{\begin{scope}[morph=box]\fill[blue] (0,0) circle (1);\end{scope}}
   \only<2>{\begin{scope}[morph=box]\fill[red] (2,0) rectangle (5,2);\end{scope}}
   ```

3. Build the HTML deck. The command writes `talk.html` next to `talk.tex`:

   ```sh
   zlides talk.tex
   ```

4. Open `talk.html` in a browser. Use the arrow keys to move, and press `f` for full screen. Press `?` to see all keys.

You build the PDF as usual, for example with `latexmk`. On Overleaf, upload `zlides.sty` for the PDF build.

## Requirements

zlides needs only a TeX installation, TeX Live or MacTeX, which include `latex`, `dvisvgm`, and `texlua`. PDF figures do not appear in the HTML deck yet. zlides was tested on macOS, in Brave, Chrome, Firefox, and WebKit.

## Documentation

The manual is `doc/latex/zlides/zlides.pdf`. It describes each key, the rules for names, the timing of each animation, the build options, latexmk integration, the URL parameters, and the known limits.
