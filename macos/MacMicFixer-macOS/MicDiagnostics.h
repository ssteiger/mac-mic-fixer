#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

extern NSNotificationName const MMFPopoverVisibilityDidChangeNotification;
extern NSNotificationName const MMFStatusIconDidChangeNotification;
extern NSNotificationName const MMFClosePopoverNotification;

extern BOOL MMFPopoverVisible;

@interface MicDiagnostics : RCTEventEmitter <RCTBridgeModule>

@end
