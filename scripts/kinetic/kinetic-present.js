// Opens a kinetic deck in a borderless macOS window with the slide aspect ratio.
// Usage: osascript -l JavaScript kinetic-present.js <deck.html>
ObjC.import("Cocoa");
ObjC.import("WebKit");

const SCREEN_FRACTION = 0.8;
const DRAG_INTERVAL_S = 1 / 60;

ObjC.registerSubclass({
  name: "KineticWindow",
  superclass: "NSWindow",
  methods: {
    canBecomeKeyWindow: { types: ["bool", []], implementation: () => true },
  },
});

let presentWindow = null;

function followMouse() {
  const start = $.NSEvent.mouseLocation;
  const origin = presentWindow.frame.origin;
  const timer = $.NSTimer.scheduledTimerWithTimeIntervalRepeatsBlock(
    DRAG_INTERVAL_S,
    true,
    () => {
      if (Number($.NSEvent.pressedMouseButtons) === 0) {
        timer.invalidate;
        return;
      }
      const now = $.NSEvent.mouseLocation;
      presentWindow.setFrameOrigin(
        $.NSMakePoint(origin.x + now.x - start.x, origin.y + now.y - start.y),
      );
    },
  );
}

ObjC.registerSubclass({
  name: "KineticDrag",
  superclass: "NSObject",
  methods: {
    "userContentController:didReceiveScriptMessage:": {
      types: ["void", ["id", "id"]],
      implementation: followMouse,
    },
  },
});

function slideSize(path) {
  const html = $.NSString.stringWithContentsOfFileEncodingError(
    path,
    $.NSUTF8StringEncoding,
    null,
  ).js;
  if (!html) {
    throw new Error("cannot read " + path);
  }
  const m = html.match(/viewBox=["'][-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)["']/);
  if (!m) {
    throw new Error("no slide in " + path + "; build it with kinetic first");
  }
  if (!html.includes('id="marks"')) {
    throw new Error(path + " was built by an older kinetic; build it again");
  }
  return { width: Number(m[1]), height: Number(m[2]) };
}

function frameFor(slide) {
  const area = $.NSScreen.mainScreen.visibleFrame;
  const scale = SCREEN_FRACTION * Math.min(
    area.size.width / slide.width,
    area.size.height / slide.height,
  );
  const w = Math.round(slide.width * scale);
  const h = Math.round(slide.height * scale);
  const x = area.origin.x + (area.size.width - w) / 2;
  const y = area.origin.y + (area.size.height - h) / 2;
  return $.NSMakeRect(x, y, w, h);
}

function appMenu() {
  const bar = $.NSMenu.alloc.init;
  const item = $.NSMenuItem.alloc.init;
  const menu = $.NSMenu.alloc.init;
  menu.addItem(
    $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent("Quit", "terminate:", "q"),
  );
  menu.addItem(
    $.NSMenuItem.alloc.initWithTitleActionKeyEquivalent("Close", "terminate:", "w"),
  );
  item.submenu = menu;
  bar.addItem(item);
  return bar;
}

function run(argv) {
  if (argv.length !== 1) {
    throw new Error("usage: kinetic --present <deck.html>");
  }
  const path = $(argv[0]).stringByStandardizingPath.js;
  const slide = slideSize(path);
  const frame = frameFor(slide);
  const app = $.NSApplication.sharedApplication;
  app.setActivationPolicy($.NSApplicationActivationPolicyRegular);
  app.mainMenu = appMenu();

  const win = $.KineticWindow.alloc.initWithContentRectStyleMaskBackingDefer(
    frame,
    $.NSWindowStyleMaskBorderless | $.NSWindowStyleMaskResizable,
    $.NSBackingStoreBuffered,
    false,
  );
  win.title = $(path).lastPathComponent.stringByDeletingPathExtension;
  win.contentAspectRatio = $.NSMakeSize(slide.width, slide.height);

  presentWindow = win;
  const config = $.WKWebViewConfiguration.alloc.init;
  config.userContentController.addScriptMessageHandlerName(
    $.KineticDrag.alloc.init,
    "kinetic",
  );
  const web = $.WKWebView.alloc.initWithFrameConfiguration($.NSZeroRect, config);
  web.autoresizingMask = $.NSViewWidthSizable | $.NSViewHeightSizable;
  const url = $.NSURL.fileURLWithPath(path);
  web.loadFileURLAllowingReadAccessToURL(url, url.URLByDeletingLastPathComponent);
  win.contentView = web;
  win.makeKeyAndOrderFront(null);
  win.makeFirstResponder(web);
  app.activateIgnoringOtherApps(true);
  app.run;
}
