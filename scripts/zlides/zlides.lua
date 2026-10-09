#!/usr/bin/env texlua
-- zlides: build a self-contained HTML deck from a Beamer source.
-- Usage: zlides [--engine=latex|dvilualatex] <file.tex>

local lfs = require("lfs")
local mime = require("mime")

local MIME = { png = "image/png", jpg = "image/jpeg", jpeg = "image/jpeg", gif = "image/gif", svg = "image/svg+xml" }
local MAX_LATEX_RUNS = 3
local ENGINES = { latex = true, dvilualatex = true }
local HTML_SETUP = [[\def\pgfsysdriver{pgfsys-dvisvgm.def}]]
  .. [[\PassOptionsToPackage{dvisvgm}{graphicx}\PassOptionsToPackage{dvisvgm}{xcolor}]]

local function fail(msg)
  io.stderr:write("zlides: " .. msg .. "\n")
  os.exit(1)
end

local function quote(s)
  if os.type == "windows" then
    return '"' .. s:gsub('"', '\\"') .. '"'
  end
  return "'" .. s:gsub("'", "'\\''") .. "'"
end

local function capture(cmd)
  local p = io.popen(cmd .. " 2>&1")
  local output = p:read("a")
  return p:close(), output
end

local function exists(path)
  return lfs.attributes(path, "mode") ~= nil
end

local function read(path)
  local f = io.open(path, "rb") or fail("cannot read " .. path)
  local data = f:read("a")
  f:close()
  return data
end

local function write(path, data)
  local f = io.open(path, "wb") or fail("cannot write " .. path)
  f:write(data)
  f:close()
end

local function dirname(path)
  return path:match("^(.*)/[^/]*$") or "."
end

local function replace(s, placeholder, value)
  local i, j = s:find(placeholder, 1, true)
  if not i then
    fail("template has no " .. placeholder)
  end
  return s:sub(1, i - 1) .. value .. s:sub(j + 1)
end

local function physical_dir(path)
  local here = lfs.currentdir()
  if not lfs.chdir(dirname(path)) then
    fail("cannot enter the directory of " .. path)
  end
  local dir = lfs.currentdir()
  lfs.chdir(here)
  return dir
end

local function script_dir()
  local target = lfs.symlinkattributes(arg[0], "target")
  if not target then
    return physical_dir(arg[0])
  end
  return physical_dir(target:sub(1, 1) == "/" and target or dirname(arg[0]) .. "/" .. target)
end

local SCRIPT_DIR = script_dir()
kpse.set_program_name("texlua", "latex")

local function script_file(name)
  local path = SCRIPT_DIR .. "/" .. name
  if exists(path) then
    return path
  end
  return kpse.find_file(name, "texmfscripts") or fail("cannot find " .. name)
end

local function json_string(s)
  return '"' .. s:gsub('[%c"\\]', function(ch)
    return string.format("\\u%04x", ch:byte())
  end) .. '"'
end

local function find_image(name, srcdir)
  if exists(srcdir .. "/" .. name) then
    return srcdir .. "/" .. name
  end
  return kpse.find_file(name, "graphic/figure") or kpse.find_file(name, "tex") or fail("image " .. name .. " not found")
end

local function read_optional(path)
  return exists(path) and read(path) or ""
end

local function run_latex(engine, stem, outdir)
  local cmd = string.format("%s -interaction=nonstopmode -output-directory=%s -jobname=%s %s",
    engine, quote(outdir), quote(stem), quote(HTML_SETUP .. "\\input{" .. stem .. ".tex}"))
  local log_path = outdir .. "/" .. stem .. ".log"
  os.remove(log_path)
  local ok, output = capture(cmd)
  if not exists(log_path) then
    fail(engine .. " did not run:\n" .. output)
  end
  local log = read(log_path)
  if not ok then
    local first = log:find("\n!") or math.max(1, #log - 2000)
    fail(engine .. " failed; from " .. log_path .. ":\n" .. log:sub(first, first + 1500))
  end
  return log
end

local function run_dvisvgm(stem, outdir)
  local ok, output = capture(string.format("dvisvgm --page=1- --no-fonts -o %s %s",
    quote(outdir .. "/" .. stem .. "-%p.svg"), quote(outdir .. "/" .. stem .. ".dvi")))
  if not ok then
    fail("dvisvgm failed:\n" .. output)
  end
  for line in output:gmatch("[^\n]+") do
    if line:find("ERROR", 1, true) then
      io.stderr:write("zlides: dvisvgm: " .. line .. "\n")
    end
  end
end

local function svg_pages(stem, outdir)
  local pages = {}
  for file in lfs.dir(outdir) do
    local n = file:match("^" .. stem:gsub("%p", "%%%0") .. "%-(%d+)%.svg$")
    if n then
      pages[#pages + 1] = { n = tonumber(n), path = outdir .. "/" .. file }
    end
  end
  table.sort(pages, function(a, b) return a.n < b.n end)
  return pages
end

local function page_markup(svg, n, srcdir, images)
  svg = svg:sub(svg:find("<svg", 1, true) or fail("no <svg> in page " .. n))
  local prefix = "p" .. n .. "-"
  svg = svg:gsub("(%s)id='", "%1id='" .. prefix)
  svg = svg:gsub("href='#", "href='#" .. prefix)
  svg = svg:gsub("url%(#", "url(#" .. prefix)
  svg = svg:gsub("xlink:href='([^#'][^']*)'", function(name)
    if not images[name] then
      local ext = (name:match("%.(%w+)$") or ""):lower()
      images[name] = "data:" .. (MIME[ext] or "application/octet-stream") .. ";base64," .. (mime.b64(read(find_image(name, srcdir))) or "")
    end
    return "data-zl-src='" .. name .. "'"
  end)
  return '<div class="page">' .. svg .. "</div>"
end

local function main()
  local engine = "latex"
  local tex
  for _, a in ipairs(arg) do
    local e = a:match("^%-%-engine=(.+)$")
    if e then
      engine = e
    elseif a:sub(1, 1) == "-" then
      fail("unknown option " .. a)
    else
      tex = a
    end
  end
  if not ENGINES[engine] then
    fail("unsupported engine " .. engine .. "; use latex or dvilualatex")
  end
  if not tex then
    fail("usage: zlides [--engine=latex|dvilualatex] <file.tex>")
  end
  if not exists(tex) then
    fail("no such file: " .. tex)
  end
  local srcdir = physical_dir(tex)
  lfs.chdir(srcdir)
  local stem = tex:match("([^/]+)%.tex$") or fail("expected a .tex file")
  local outdir = srcdir .. "/" .. stem .. ".zlides"
  lfs.mkdir(outdir)
  local sty = SCRIPT_DIR .. "/../../tex/latex/zlides"
  if exists(sty .. "/zlides.sty") then
    os.setenv("TEXINPUTS", sty .. "//:" .. (os.getenv("TEXINPUTS") or ""))
  end

  os.remove(outdir .. "/" .. stem .. ".dvi")
  local bbl = srcdir .. "/" .. stem .. ".bbl"
  if exists(bbl) then
    write(outdir .. "/" .. stem .. ".bbl", read(bbl))
  end
  local aux = outdir .. "/" .. stem .. ".aux"
  local before = read_optional(aux)
  local settled = false
  for _ = 1, MAX_LATEX_RUNS do
    local log = run_latex(engine, stem, outdir)
    local after = read_optional(aux)
    settled = after == before and not log:find("Rerun to", 1, true)
    if settled then
      break
    end
    before = after
  end
  if not settled then
    io.stderr:write("zlides: references still changed after " .. MAX_LATEX_RUNS .. " LaTeX runs\n")
  end
  for _, page in ipairs(svg_pages(stem, outdir)) do
    os.remove(page.path)
  end
  run_dvisvgm(stem, outdir)

  local images = {}
  local markup = {}
  for _, page in ipairs(svg_pages(stem, outdir)) do
    markup[#markup + 1] = page_markup(read(page.path), page.n, srcdir, images)
  end
  local entries = {}
  for name, uri in pairs(images) do
    entries[#entries + 1] = json_string(name) .. ":" .. json_string(uri)
  end
  local html = read(script_file("zlides-template.html"))
  html = replace(html, "/*VIEWER*/", read(script_file("zlides-viewer.js")))
  html = replace(html, "<!--PAGES-->", table.concat(markup, "\n"))
  html = replace(html, "/*IMAGES*/", "{" .. table.concat(entries, ",") .. "}")
  local out = srcdir .. "/" .. stem .. ".html"
  write(out, html)
  print(out .. " (" .. #markup .. " pages)")
end

main()
