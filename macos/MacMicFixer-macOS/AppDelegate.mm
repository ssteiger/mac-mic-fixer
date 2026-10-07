#import "AppDelegate.h"
#import "MicDiagnostics.h"

#import <React/RCTBundleURLProvider.h>
#import <React/RCTDevLoadingViewSetEnabled.h>
#import <React/RCTRootView.h>
#import <ReactAppDependencyProvider/RCTAppDependencyProvider.h>

static const NSSize kPopoverSize = {400, 720};
static NSString *const kStatusItemAutosaveName = @"MacMicFixerStatusItem";
// Distance from the right screen edge, in points.
static const double kInitialStatusItemPosition = 400;

@implementation AppDelegate {
  NSStatusItem *_statusItem;
  NSPopover *_popover;
  NSMenu *_contextMenu;
  id _outsideClickMonitor;
  id _escapeKeyMonitor;
}

- (void)applicationWillFinishLaunching:(NSNotification *)notification
{
  // The UI uses a fixed dark palette, so the popover chrome and arrow have to be dark too. Set before React Native
  // starts: NSApp.effectiveAppearance only updates on the next run loop pass, and React Native's Appearance module
  // reads it once at startup.
  NSApp.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
}

- (void)applicationDidFinishLaunching:(NSNotification *)notification
{
  self.moduleName = @"MacMicFixer";
  self.initialProps = @{};
  self.dependencyProvider = [RCTAppDependencyProvider new];
  // The app lives in the menu bar, so React Native renders into a popover instead of a window.
  self.automaticallyLoadReactNativeWindow = NO;
  // The "Loading from Metro" banner is a sheet on the key window, which here is the popover. It covers the whole
  // popover and stays stuck if the popover is no longer key when loading finishes.
  RCTDevLoadingViewSetEnabled(NO);

  [super applicationDidFinishLaunching:notification];

  [self setUpPopoverWithLaunchOptions:notification.userInfo];
  [self setUpStatusItem];

  NSNotificationCenter *center = [NSNotificationCenter defaultCenter];
  [center addObserver:self
             selector:@selector(statusIconDidChange:)
                 name:MMFStatusIconDidChangeNotification
               object:nil];
  [center addObserver:self selector:@selector(closePopover:) name:MMFClosePopoverNotification object:nil];
}

- (void)setUpPopoverWithLaunchOptions:(NSDictionary *)launchOptions
{
  NSView *rootView = [self.rootViewFactory viewWithModuleName:self.moduleName
                                            initialProperties:self.initialProps
                                                launchOptions:launchOptions];
  rootView.frame = NSMakeRect(0, 0, kPopoverSize.width, kPopoverSize.height);
  // Inside the popover the view would inherit a composite vibrant appearance, which React Native reads as light.
  rootView.appearance = [NSAppearance appearanceNamed:NSAppearanceNameDarkAqua];
  if ([rootView isKindOfClass:[RCTRootView class]]) {
    ((RCTRootView *)rootView).backgroundColor = [NSColor clearColor];
  }

  NSViewController *controller = [NSViewController new];
  controller.view = rootView;

  _popover = [NSPopover new];
  _popover.contentViewController = controller;
  _popover.contentSize = kPopoverSize;
  // Transient popovers close as soon as the app loses activation, which on macOS 14+ can happen right after opening.
  // Closing is handled by the click and Esc monitors installed in popoverDidShow: instead.
  _popover.behavior = NSPopoverBehaviorApplicationDefined;
  _popover.animates = YES;
  _popover.delegate = self;
}

- (void)setUpStatusItem
{
  // macOS adds new status items at the far left, which on crowded menu bars of notched MacBooks is hidden behind
  // the camera housing. Start next to the system items instead; Cmd-dragging the icon overrides this.
  NSString *positionKey = [@"NSStatusItem Preferred Position " stringByAppendingString:kStatusItemAutosaveName];
  NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
  if ([defaults objectForKey:positionKey] == nil) {
    [defaults setDouble:kInitialStatusItemPosition forKey:positionKey];
  }

  _statusItem = [[NSStatusBar systemStatusBar] statusItemWithLength:NSSquareStatusItemLength];
  _statusItem.autosaveName = kStatusItemAutosaveName;

  NSStatusBarButton *button = _statusItem.button;
  button.target = self;
  button.action = @selector(statusItemClicked:);
  [button sendActionOn:NSEventMaskLeftMouseUp | NSEventMaskRightMouseUp];
  [self applyStatusIcon:@"ok" toolTip:@"Mac Mic Fixer"];

  // Right-click menu, so the app can always be quit even if the JS bundle fails to load.
  _contextMenu = [NSMenu new];
  NSMenuItem *quitItem = [_contextMenu addItemWithTitle:@"Quit Mac Mic Fixer"
                                                 action:@selector(terminate:)
                                          keyEquivalent:@"q"];
  quitItem.target = NSApp;
}

- (void)statusItemClicked:(NSStatusBarButton *)sender
{
  NSEvent *event = NSApp.currentEvent;
  BOOL wantsMenu = event.type == NSEventTypeRightMouseUp ||
      (event.modifierFlags & NSEventModifierFlagControl) == NSEventModifierFlagControl;
  if (wantsMenu) {
    [_popover performClose:nil];
    [_contextMenu popUpMenuPositioningItem:nil
                                atLocation:NSMakePoint(0, NSHeight(sender.bounds) + 4)
                                    inView:sender];
    return;
  }
  [self togglePopover];
}

// Launching the app again (Spotlight, Finder) opens the dropdown, in case the icon is hidden in a full menu bar.
- (BOOL)applicationShouldHandleReopen:(NSApplication *)sender hasVisibleWindows:(BOOL)flag
{
  if (!_popover.isShown) {
    [self showPopover];
  }
  return NO;
}

- (void)togglePopover
{
  if (_popover.isShown) {
    [_popover performClose:nil];
    return;
  }
  [self showPopover];
}

- (void)showPopover
{
  NSStatusBarButton *button = _statusItem.button;
  [NSApp activate];
  [_popover showRelativeToRect:button.bounds ofView:button preferredEdge:NSRectEdgeMinY];
  [_popover.contentViewController.view.window makeKeyWindow];
}

- (void)closePopover:(NSNotification *)notification
{
  dispatch_async(dispatch_get_main_queue(), ^{
    [self->_popover performClose:nil];
  });
}

#pragma mark - Status icon

- (void)statusIconDidChange:(NSNotification *)notification
{
  NSString *kind = notification.userInfo[@"kind"];
  NSString *toolTip = notification.userInfo[@"toolTip"];
  dispatch_async(dispatch_get_main_queue(), ^{
    [self applyStatusIcon:kind toolTip:toolTip];
  });
}

- (void)applyStatusIcon:(NSString *)kind toolTip:(NSString *)toolTip
{
  BOOL broken = [kind isEqualToString:@"muted"] || [kind isEqualToString:@"error"];
  NSString *symbol = broken ? @"mic.slash.fill" : @"mic.fill";
  NSImage *image = [NSImage imageWithSystemSymbolName:symbol accessibilityDescription:toolTip ?: @"Mac Mic Fixer"];
  [image setTemplate:YES];
  _statusItem.button.image = image;
  _statusItem.button.toolTip = toolTip;
}

#pragma mark - NSPopoverDelegate

- (void)popoverDidShow:(NSNotification *)notification
{
  [self setPopoverVisible:YES];
  dispatch_async(dispatch_get_main_queue(), ^{
    [self->_statusItem.button highlight:YES];
  });

  __weak NSPopover *popover = _popover;
  _outsideClickMonitor =
      [NSEvent addGlobalMonitorForEventsMatchingMask:NSEventMaskLeftMouseDown | NSEventMaskRightMouseDown
                                             handler:^(NSEvent *event) {
                                               [popover performClose:nil];
                                             }];
  _escapeKeyMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskKeyDown
                                                            handler:^NSEvent *(NSEvent *event) {
                                                              if (event.keyCode == 53) { // Esc
                                                                [popover performClose:nil];
                                                                return nil;
                                                              }
                                                              return event;
                                                            }];
}

- (void)popoverDidClose:(NSNotification *)notification
{
  for (id monitor in @[ _outsideClickMonitor ?: [NSNull null], _escapeKeyMonitor ?: [NSNull null] ]) {
    if (monitor != [NSNull null]) {
      [NSEvent removeMonitor:monitor];
    }
  }
  _outsideClickMonitor = nil;
  _escapeKeyMonitor = nil;

  [self setPopoverVisible:NO];
  [_statusItem.button highlight:NO];
}

- (void)setPopoverVisible:(BOOL)visible
{
  MMFPopoverVisible = visible;
  [[NSNotificationCenter defaultCenter] postNotificationName:MMFPopoverVisibilityDidChangeNotification
                                                      object:nil
                                                    userInfo:@{@"visible" : @(visible)}];
}

#pragma mark - React Native

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

/// This method controls whether the `concurrentRoot`feature of React18 is turned on or off.
///
/// @see: https://reactjs.org/blog/2022/03/29/react-v18.html
/// @note: This requires to be rendering on Fabric (i.e. on the New Architecture).
/// @return: `true` if the `concurrentRoot` feature is enabled. Otherwise, it returns `false`.
- (BOOL)concurrentRootEnabled
{
#ifdef RN_FABRIC_ENABLED
  return true;
#else
  return false;
#endif
}

@end
