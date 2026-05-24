#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

@interface AppDelegate : NSObject <NSApplicationDelegate, NSWindowDelegate>
@property(nonatomic, strong) NSWindow *window;
@property(nonatomic, strong) WKWebView *webView;
@property(nonatomic, strong) NSTask *serverTask;
@property(nonatomic, strong) NSStatusItem *statusItem;
@property(nonatomic, copy) NSString *port;
@property(nonatomic, assign) BOOL statusLaunchInProgress;
@end

@implementation AppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    self.port = [[[NSProcessInfo processInfo] environment] objectForKey:@"PORT"] ?: @"38383";
    [self installApplicationMenu];
    [self installStatusItem];
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
    return NO;
}

- (void)applicationWillTerminate:(NSNotification *)notification {
    [self stopServer];
}

- (void)createWindow {
    WKWebViewConfiguration *configuration = [[WKWebViewConfiguration alloc] init];
    configuration.preferences.javaScriptCanOpenWindowsAutomatically = YES;
    self.webView = [[WKWebView alloc] initWithFrame:NSZeroRect configuration:configuration];

    self.window = [[NSWindow alloc]
        initWithContentRect:NSMakeRect(0, 0, 1120, 760)
                  styleMask:(NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable)
                    backing:NSBackingStoreBuffered
                      defer:NO];
    self.window.title = @"Codex Switch";
    self.window.delegate = self;
    self.window.contentView = self.webView;
    [self.window center];
}

- (void)installApplicationMenu {
    NSMenu *mainMenu = [[NSMenu alloc] initWithTitle:@""];

    NSMenuItem *appItem = [[NSMenuItem alloc] initWithTitle:@"" action:nil keyEquivalent:@""];
    NSMenu *appMenu = [[NSMenu alloc] initWithTitle:@"Codex Switch"];
    [appMenu addItemWithTitle:@"Quit Codex Switch" action:@selector(terminate:) keyEquivalent:@"q"];
    appItem.submenu = appMenu;
    [mainMenu addItem:appItem];

    NSMenuItem *editItem = [[NSMenuItem alloc] initWithTitle:@"" action:nil keyEquivalent:@""];
    NSMenu *editMenu = [[NSMenu alloc] initWithTitle:@"Edit"];
    [editMenu addItemWithTitle:@"Cut" action:@selector(cut:) keyEquivalent:@"x"];
    [editMenu addItemWithTitle:@"Copy" action:@selector(copy:) keyEquivalent:@"c"];
    [editMenu addItemWithTitle:@"Paste" action:@selector(paste:) keyEquivalent:@"v"];
    [editMenu addItemWithTitle:@"Select All" action:@selector(selectAll:) keyEquivalent:@"a"];
    editItem.submenu = editMenu;
    [mainMenu addItem:editItem];

    [NSApp setMainMenu:mainMenu];
}

- (void)installStatusItem {
    self.statusItem = [[NSStatusBar systemStatusBar] statusItemWithLength:NSSquareStatusItemLength];
    self.statusItem.button.image = [self statusBarImage];
    self.statusItem.button.imagePosition = NSImageOnly;
    self.statusItem.button.toolTip = @"Codex Switch";

    NSMenu *menu = [[NSMenu alloc] initWithTitle:@"Codex Switch"];
    NSMenuItem *showItem = [menu addItemWithTitle:@"打开面板" action:@selector(showWindow:) keyEquivalent:@""];
    showItem.target = self;
    NSMenuItem *launchItem = [menu addItemWithTitle:@"启动" action:@selector(launchCodexFromStatusItem:) keyEquivalent:@""];
    launchItem.target = self;
    NSMenuItem *quitItem = [menu addItemWithTitle:@"退出" action:@selector(quitFromStatusItem:) keyEquivalent:@"q"];
    quitItem.target = self;
    self.statusItem.menu = menu;
}

- (NSImage *)statusBarImage {
    NSImage *image = [[NSImage alloc] initWithSize:NSMakeSize(18, 18)];
    [image lockFocus];

    [[NSColor blackColor] setStroke];
    [[NSColor blackColor] setFill];

    NSBezierPath *body = [NSBezierPath bezierPathWithRoundedRect:NSMakeRect(4.2, 8.0, 9.8, 6.4) xRadius:1.8 yRadius:1.8];
    body.lineWidth = 1.7;
    [body stroke];

    NSBezierPath *shackle = [NSBezierPath bezierPath];
    shackle.lineWidth = 1.7;
    shackle.lineCapStyle = NSLineCapStyleRound;
    [shackle moveToPoint:NSMakePoint(7.0, 8.2)];
    [shackle lineToPoint:NSMakePoint(7.0, 6.0)];
    [shackle curveToPoint:NSMakePoint(12.4, 5.8)
            controlPoint1:NSMakePoint(7.0, 2.9)
            controlPoint2:NSMakePoint(12.4, 2.9)];
    [shackle stroke];

    NSBezierPath *keyhole = [NSBezierPath bezierPathWithOvalInRect:NSMakeRect(8.55, 10.05, 1.9, 1.9)];
    [keyhole fill];
    NSBezierPath *slot = [NSBezierPath bezierPathWithRoundedRect:NSMakeRect(9.18, 11.35, 0.65, 1.8) xRadius:0.32 yRadius:0.32];
    [slot fill];

    [image unlockFocus];
    image.template = YES;
    return image;
}

- (void)showWindow:(id)sender {
    if (!self.window) {
        [self createWindow];
    }
    [self.window makeKeyAndOrderFront:nil];
    [NSApp activateIgnoringOtherApps:YES];
    [self startOrReuseServer];
}

- (void)hideWindow:(id)sender {
    [self.window orderOut:nil];
    [self stopServer];
}

- (BOOL)windowShouldClose:(NSWindow *)sender {
    [self hideWindow:nil];
    return NO;
}

- (void)quitFromStatusItem:(id)sender {
    [self stopServer];
    [NSApp terminate:nil];
}

- (void)launchCodexFromStatusItem:(id)sender {
    if (self.statusLaunchInProgress) return;
    self.statusLaunchInProgress = YES;
    [self setStatusLaunchMenuItemEnabled:NO];

    [self startOrReuseServerForTask:^{
        [self postLaunchRequestWithCompletion:^(BOOL ok, NSString *message) {
            dispatch_async(dispatch_get_main_queue(), ^{
                self.statusLaunchInProgress = NO;
                [self setStatusLaunchMenuItemEnabled:YES];
                if (!self.window.visible) {
                    [self stopServer];
                }
                if (!ok) {
                    [self showNativeError:message ?: @"启动 Codex 失败"];
                }
            });
        }];
    }];
}

- (void)setStatusLaunchMenuItemEnabled:(BOOL)enabled {
    NSMenuItem *item = [self.statusItem.menu itemWithTitle:@"启动"];
    item.enabled = enabled;
    item.title = enabled ? @"启动" : @"启动中...";
}

- (NSURL *)baseURL {
    return [NSURL URLWithString:[NSString stringWithFormat:@"http://127.0.0.1:%@", self.port]];
}

- (void)startOrReuseServer {
    [self probeServer:^(BOOL available) {
        dispatch_async(dispatch_get_main_queue(), ^{
            if (available) {
                [self loadApp];
                return;
            }
            NSError *error = nil;
            if (![self startServer:&error]) {
                [self showError:[NSString stringWithFormat:@"启动本地服务失败：%@", error.localizedDescription]];
                return;
            }
            [self waitForServer:50];
        });
    }];
}

- (void)startOrReuseServerForTask:(void (^)(void))ready {
    [self probeServer:^(BOOL available) {
        dispatch_async(dispatch_get_main_queue(), ^{
            if (available) {
                ready();
                return;
            }
            NSError *error = nil;
            if (![self startServer:&error]) {
                self.statusLaunchInProgress = NO;
                [self setStatusLaunchMenuItemEnabled:YES];
                [self showNativeError:[NSString stringWithFormat:@"启动本地服务失败：%@", error.localizedDescription]];
                return;
            }
            [self waitForServerForTask:50 ready:ready];
        });
    }];
}

- (BOOL)startServer:(NSError **)error {
    if (self.serverTask && self.serverTask.isRunning) {
        return YES;
    }
    NSURL *resources = [[NSBundle mainBundle] resourceURL];
    NSURL *appDirectory = [resources URLByAppendingPathComponent:@"app" isDirectory:YES];
    NSURL *server = [appDirectory URLByAppendingPathComponent:@"server.js"];
    if (![[NSFileManager defaultManager] fileExistsAtPath:server.path]) {
        if (error) {
            *error = [NSError errorWithDomain:@"CodexSwitch" code:1 userInfo:@{NSLocalizedDescriptionKey: @"找不到 server.js"}];
        }
        return NO;
    }

    NSString *node = [self findNodeExecutable];
    if (!node) {
        if (error) {
            *error = [NSError errorWithDomain:@"CodexSwitch" code:2 userInfo:@{NSLocalizedDescriptionKey: @"找不到 Node.js，请先安装 Node，或设置 CODEX_SWITCH_NODE"}];
        }
        return NO;
    }

    NSTask *task = [[NSTask alloc] init];
    task.executableURL = [NSURL fileURLWithPath:node];
    task.arguments = @[@"server.js"];
    task.currentDirectoryURL = appDirectory;

    NSMutableDictionary *environment = [[[NSProcessInfo processInfo] environment] mutableCopy];
    environment[@"PORT"] = self.port;
    task.environment = environment;

    NSPipe *pipe = [NSPipe pipe];
    task.standardOutput = pipe;
    task.standardError = pipe;

    BOOL ok = [task launchAndReturnError:error];
    if (ok) {
        self.serverTask = task;
    }
    return ok;
}

- (void)stopServer {
    if (self.serverTask && self.serverTask.isRunning) {
        [self.serverTask terminate];
        [self.serverTask waitUntilExit];
    }
    self.serverTask = nil;
}

- (void)waitForServer:(NSInteger)attemptsLeft {
    if (attemptsLeft <= 0) {
        [self showError:[NSString stringWithFormat:@"本地服务没有在 127.0.0.1:%@ 就绪。", self.port]];
        return;
    }
    [self probeServer:^(BOOL available) {
        dispatch_async(dispatch_get_main_queue(), ^{
            if (available) {
                [self loadApp];
            } else {
                dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.25 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
                    [self waitForServer:attemptsLeft - 1];
                });
            }
        });
    }];
}

- (void)waitForServerForTask:(NSInteger)attemptsLeft ready:(void (^)(void))ready {
    if (attemptsLeft <= 0) {
        self.statusLaunchInProgress = NO;
        [self setStatusLaunchMenuItemEnabled:YES];
        [self stopServer];
        [self showNativeError:[NSString stringWithFormat:@"本地服务没有在 127.0.0.1:%@ 就绪。", self.port]];
        return;
    }
    [self probeServer:^(BOOL available) {
        dispatch_async(dispatch_get_main_queue(), ^{
            if (available) {
                ready();
            } else {
                dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.25 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
                    [self waitForServerForTask:attemptsLeft - 1 ready:ready];
                });
            }
        });
    }];
}

- (void)probeServer:(void (^)(BOOL available))completion {
    NSURL *statusURL = [[self baseURL] URLByAppendingPathComponent:@"api/status"];
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:statusURL];
    request.timeoutInterval = 1.5;
    NSURLSessionDataTask *task = [[NSURLSession sharedSession]
        dataTaskWithRequest:request
          completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
              NSInteger code = [(NSHTTPURLResponse *)response statusCode];
              completion(error == nil && code == 200);
          }];
    [task resume];
}

- (void)loadApp {
    [self.webView loadRequest:[NSURLRequest requestWithURL:[self baseURL]]];
}

- (void)postLaunchRequestWithCompletion:(void (^)(BOOL ok, NSString *message))completion {
    NSURL *launchURL = [[self baseURL] URLByAppendingPathComponent:@"api/launch"];
    NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:launchURL];
    request.HTTPMethod = @"POST";
    request.timeoutInterval = 30;
    [request setValue:@"application/json" forHTTPHeaderField:@"content-type"];
    request.HTTPBody = [@"{\"debugPort\":9229}" dataUsingEncoding:NSUTF8StringEncoding];

    NSURLSessionDataTask *task = [[NSURLSession sharedSession]
        dataTaskWithRequest:request
          completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
              if (error) {
                  completion(NO, error.localizedDescription);
                  return;
              }
              NSInteger code = [(NSHTTPURLResponse *)response statusCode];
              NSString *text = data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : @"";
              if (code < 200 || code >= 300) {
                  completion(NO, text.length > 0 ? text : [NSString stringWithFormat:@"HTTP %ld", (long)code]);
                  return;
              }
              completion(YES, text);
          }];
    [task resume];
}

- (void)showError:(NSString *)message {
    NSString *escaped = [message stringByReplacingOccurrencesOfString:@"&" withString:@"&amp;"];
    escaped = [escaped stringByReplacingOccurrencesOfString:@"<" withString:@"&lt;"];
    escaped = [escaped stringByReplacingOccurrencesOfString:@">" withString:@"&gt;"];
    NSString *html = [NSString stringWithFormat:
        @"<!doctype html><meta charset='utf-8'>"
         "<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#111312;color:#f4f6f2;font:14px -apple-system,BlinkMacSystemFont,sans-serif}"
         "main{width:min(560px,calc(100vw - 48px));border:1px solid #31382f;border-radius:8px;background:#181b19;padding:20px}"
         "h1{margin:0 0 10px;font-size:20px}p{margin:0;color:#f87171;line-height:1.5}</style>"
         "<main><h1>Codex Switch</h1><p>%@</p></main>",
        escaped];
    [self.webView loadHTMLString:html baseURL:nil];
}

- (void)showNativeError:(NSString *)message {
    NSAlert *alert = [[NSAlert alloc] init];
    alert.messageText = @"Codex Switch";
    alert.informativeText = message ?: @"操作失败";
    alert.alertStyle = NSAlertStyleWarning;
    [alert addButtonWithTitle:@"好"];
    [alert runModal];
}

- (NSString *)findNodeExecutable {
    NSMutableArray<NSString *> *candidates = [NSMutableArray array];
    NSDictionary *environment = [[NSProcessInfo processInfo] environment];
    NSString *configured = environment[@"CODEX_SWITCH_NODE"] ?: environment[@"CUSTOM_CODEX_LITE_NODE"];
    if (configured.length > 0) {
        [candidates addObject:configured];
    }
    NSString *pathValue = environment[@"PATH"] ?: @"";
    for (NSString *part in [pathValue componentsSeparatedByString:@":"]) {
        if (part.length > 0) {
            [candidates addObject:[part stringByAppendingPathComponent:@"node"]];
        }
    }
    [candidates addObjectsFromArray:@[
        @"/opt/homebrew/bin/node",
        @"/usr/local/bin/node",
        @"/usr/bin/node"
    ]];

    NSFileManager *fileManager = [NSFileManager defaultManager];
    for (NSString *candidate in candidates) {
        if ([fileManager isExecutableFileAtPath:candidate]) {
            return candidate;
        }
    }
    return nil;
}

@end

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        NSApplication *application = [NSApplication sharedApplication];
        AppDelegate *delegate = [[AppDelegate alloc] init];
        application.delegate = delegate;
        [application setActivationPolicy:NSApplicationActivationPolicyAccessory];
        [application run];
    }
    return 0;
}
