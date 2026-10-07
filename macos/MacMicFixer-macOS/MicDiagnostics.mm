#import "MicDiagnostics.h"

#import <AVFoundation/AVFoundation.h>
#import <AppKit/AppKit.h>
#import <CoreAudio/CoreAudio.h>
#import <LocalAuthentication/LocalAuthentication.h>
#import <ctype.h>
#import <fcntl.h>
#import <libproc.h>
#import <sqlite3.h>
#import <sys/param.h>
#import <unistd.h>

#include <algorithm>
#include <cmath>
#include <vector>

NSNotificationName const MMFPopoverVisibilityDidChangeNotification = @"MMFPopoverVisibilityDidChangeNotification";
NSNotificationName const MMFStatusIconDidChangeNotification = @"MMFStatusIconDidChangeNotification";
NSNotificationName const MMFClosePopoverNotification = @"MMFClosePopoverNotification";

BOOL MMFPopoverVisible = NO;

static NSString *const kDevicesChangedEvent = @"onDevicesChanged";
static NSString *const kDeviceStateChangedEvent = @"onDeviceStateChanged";
static NSString *const kLevelEvent = @"onLevel";
static NSString *const kLevelMeterErrorEvent = @"onLevelMeterError";
static NSString *const kPopoverVisibilityEvent = @"onPopoverVisibility";

static const double kLevelFloorDb = -120;
static const CFAbsoluteTime kLevelEmitInterval = 0.05;
static const size_t kMaxMeteredChannels = 16;

#pragma mark - CoreAudio helpers

namespace {

AudioObjectPropertyAddress Address(
    AudioObjectPropertySelector selector,
    AudioObjectPropertyScope scope = kAudioObjectPropertyScopeGlobal,
    AudioObjectPropertyElement element = kAudioObjectPropertyElementMain)
{
  return {selector, scope, element};
}

bool HasProperty(AudioObjectID object, AudioObjectPropertyAddress address)
{
  return AudioObjectHasProperty(object, &address);
}

bool IsSettable(AudioObjectID object, AudioObjectPropertyAddress address)
{
  Boolean settable = false;
  return AudioObjectIsPropertySettable(object, &address, &settable) == noErr && settable;
}

template <typename T>
bool GetValue(AudioObjectID object, AudioObjectPropertyAddress address, T &value)
{
  if (!AudioObjectHasProperty(object, &address)) {
    return false;
  }
  UInt32 size = sizeof(T);
  return AudioObjectGetPropertyData(object, &address, 0, nullptr, &size, &value) == noErr;
}

template <typename T>
OSStatus SetValue(AudioObjectID object, AudioObjectPropertyAddress address, T value)
{
  return AudioObjectSetPropertyData(object, &address, 0, nullptr, sizeof(T), &value);
}

template <typename T>
std::vector<T> GetArray(AudioObjectID object, AudioObjectPropertyAddress address)
{
  UInt32 size = 0;
  if (!AudioObjectHasProperty(object, &address) ||
      AudioObjectGetPropertyDataSize(object, &address, 0, nullptr, &size) != noErr || size == 0) {
    return {};
  }
  std::vector<T> values(size / sizeof(T));
  if (AudioObjectGetPropertyData(object, &address, 0, nullptr, &size, values.data()) != noErr) {
    return {};
  }
  values.resize(size / sizeof(T));
  return values;
}

NSString *GetString(AudioObjectID object, AudioObjectPropertyAddress address)
{
  CFStringRef value = nullptr;
  UInt32 size = sizeof(value);
  if (!AudioObjectHasProperty(object, &address) ||
      AudioObjectGetPropertyData(object, &address, 0, nullptr, &size, &value) != noErr || value == nullptr) {
    return nil;
  }
  return (__bridge_transfer NSString *)value;
}

UInt32 ChannelCount(AudioObjectID device, AudioObjectPropertyScope scope)
{
  AudioObjectPropertyAddress address = Address(kAudioDevicePropertyStreamConfiguration, scope);
  UInt32 size = 0;
  if (AudioObjectGetPropertyDataSize(device, &address, 0, nullptr, &size) != noErr || size == 0) {
    return 0;
  }
  std::vector<uint8_t> storage(size);
  auto *list = reinterpret_cast<AudioBufferList *>(storage.data());
  if (AudioObjectGetPropertyData(device, &address, 0, nullptr, &size, list) != noErr) {
    return 0;
  }
  UInt32 channels = 0;
  for (UInt32 i = 0; i < list->mNumberBuffers; i++) {
    channels += list->mBuffers[i].mNumberChannels;
  }
  return channels;
}

AudioDeviceID DefaultDevice(AudioObjectPropertySelector selector)
{
  AudioDeviceID device = kAudioObjectUnknown;
  GetValue(kAudioObjectSystemObject, Address(selector), device);
  return device;
}

AudioDeviceID DefaultInputDevice()
{
  return DefaultDevice(kAudioHardwarePropertyDefaultInputDevice);
}

// Devices expose controls either on the main element or per channel.
std::vector<AudioObjectPropertyElement>
ElementsWithProperty(AudioObjectID device, AudioObjectPropertySelector selector, AudioObjectPropertyScope scope)
{
  if (HasProperty(device, Address(selector, scope, kAudioObjectPropertyElementMain))) {
    return {kAudioObjectPropertyElementMain};
  }
  std::vector<AudioObjectPropertyElement> elements;
  UInt32 channels = ChannelCount(device, scope);
  for (UInt32 channel = 1; channel <= channels; channel++) {
    if (HasProperty(device, Address(selector, scope, channel))) {
      elements.push_back(channel);
    }
  }
  return elements;
}

NSString *TransportName(UInt32 transport)
{
  switch (transport) {
    case kAudioDeviceTransportTypeBuiltIn:
      return @"builtIn";
    case kAudioDeviceTransportTypeUSB:
      return @"usb";
    case kAudioDeviceTransportTypeBluetooth:
      return @"bluetooth";
    case kAudioDeviceTransportTypeBluetoothLE:
      return @"bluetoothLE";
    case kAudioDeviceTransportTypeAggregate:
    case kAudioDeviceTransportTypeAutoAggregate:
      return @"aggregate";
    case kAudioDeviceTransportTypeVirtual:
      return @"virtual";
    case kAudioDeviceTransportTypeHDMI:
      return @"hdmi";
    case kAudioDeviceTransportTypeDisplayPort:
      return @"displayPort";
    case kAudioDeviceTransportTypeAirPlay:
      return @"airPlay";
    case kAudioDeviceTransportTypeThunderbolt:
      return @"thunderbolt";
    case kAudioDeviceTransportTypePCI:
      return @"pci";
    case kAudioDeviceTransportTypeFireWire:
      return @"fireWire";
    case kAudioDeviceTransportTypeAVB:
      return @"avb";
    case kAudioDeviceTransportTypeContinuityCaptureWired:
    case kAudioDeviceTransportTypeContinuityCaptureWireless:
      return @"continuity";
    default:
      return @"unknown";
  }
}

NSString *StatusString(OSStatus status)
{
  UInt32 bigEndian = CFSwapInt32HostToBig((UInt32)status);
  char code[5] = {0};
  memcpy(code, &bigEndian, 4);
  if (isprint(code[0]) && isprint(code[1]) && isprint(code[2]) && isprint(code[3])) {
    return [NSString stringWithFormat:@"'%s' (%d)", code, (int)status];
  }
  return [NSString stringWithFormat:@"%d", (int)status];
}

std::vector<AudioDeviceID> InputDevices()
{
  std::vector<AudioDeviceID> devices;
  for (AudioDeviceID device : GetArray<AudioDeviceID>(kAudioObjectSystemObject, Address(kAudioHardwarePropertyDevices))) {
    UInt32 hidden = 0;
    GetValue(device, Address(kAudioDevicePropertyIsHidden), hidden);
    if (!hidden && ChannelCount(device, kAudioObjectPropertyScopeInput) > 0) {
      devices.push_back(device);
    }
  }
  return devices;
}

NSDictionary *DeviceInfo(AudioDeviceID device, AudioDeviceID defaultInput)
{
  UInt32 transport = 0;
  GetValue(device, Address(kAudioDevicePropertyTransportType), transport);
  UInt32 alive = 1;
  GetValue(device, Address(kAudioDevicePropertyDeviceIsAlive), alive);
  UInt32 running = 0;
  GetValue(device, Address(kAudioDevicePropertyDeviceIsRunningSomewhere), running);

  return @{
    @"id" : @(device),
    @"uid" : GetString(device, Address(kAudioDevicePropertyDeviceUID)) ?: @"",
    @"name" : GetString(device, Address(kAudioObjectPropertyName)) ?: @"Unknown device",
    @"manufacturer" : GetString(device, Address(kAudioObjectPropertyManufacturer)) ?: @"",
    @"transport" : TransportName(transport),
    @"channels" : @(ChannelCount(device, kAudioObjectPropertyScopeInput)),
    @"isDefault" : @(device == defaultInput),
    @"isAlive" : @(alive != 0),
    @"isRunningSomewhere" : @(running != 0),
  };
}

NSDictionary *VolumeInfo(AudioDeviceID device)
{
  const AudioObjectPropertyScope input = kAudioObjectPropertyScopeInput;
  auto volumeElements = ElementsWithProperty(device, kAudioDevicePropertyVolumeScalar, input);
  auto muteElements = ElementsWithProperty(device, kAudioDevicePropertyMute, input);

  NSMutableDictionary *info = [@{
    @"hasVolume" : @(!volumeElements.empty()),
    @"volumeSettable" : @NO,
    @"volume" : [NSNull null],
    @"volumeDb" : [NSNull null],
    @"hasMute" : @(!muteElements.empty()),
    @"muteSettable" : @NO,
    @"muted" : [NSNull null],
  } mutableCopy];

  if (!volumeElements.empty()) {
    Float32 sum = 0;
    UInt32 count = 0;
    bool settable = false;
    for (auto element : volumeElements) {
      auto address = Address(kAudioDevicePropertyVolumeScalar, input, element);
      Float32 volume = 0;
      if (GetValue(device, address, volume)) {
        sum += volume;
        count++;
      }
      settable = settable || IsSettable(device, address);
    }
    if (count > 0) {
      info[@"volume"] = @(sum / count);
    }
    info[@"volumeSettable"] = @(settable);
    Float32 decibels = 0;
    if (GetValue(device, Address(kAudioDevicePropertyVolumeDecibels, input, volumeElements.front()), decibels)) {
      info[@"volumeDb"] = @(decibels);
    }
  }

  if (!muteElements.empty()) {
    bool muted = false;
    bool settable = false;
    for (auto element : muteElements) {
      auto address = Address(kAudioDevicePropertyMute, input, element);
      UInt32 value = 0;
      if (GetValue(device, address, value)) {
        muted = muted || value != 0;
      }
      settable = settable || IsSettable(device, address);
    }
    info[@"muted"] = @(muted);
    info[@"muteSettable"] = @(settable);
  }

  return info;
}

NSArray<NSNumber *> *AvailableSampleRates(AudioDeviceID device)
{
  static const double kCommonRates[] = {
      8000, 11025, 16000, 22050, 24000, 32000, 44100, 48000, 88200, 96000, 176400, 192000};
  std::vector<double> rates;
  for (const AudioValueRange &range :
       GetArray<AudioValueRange>(device, Address(kAudioDevicePropertyAvailableNominalSampleRates))) {
    if (range.mMinimum == range.mMaximum) {
      rates.push_back(range.mMinimum);
      continue;
    }
    for (double rate : kCommonRates) {
      if (rate >= range.mMinimum && rate <= range.mMaximum) {
        rates.push_back(rate);
      }
    }
  }
  std::sort(rates.begin(), rates.end());
  rates.erase(std::unique(rates.begin(), rates.end()), rates.end());

  NSMutableArray<NSNumber *> *result = [NSMutableArray arrayWithCapacity:rates.size()];
  for (double rate : rates) {
    [result addObject:@(rate)];
  }
  return result;
}

NSDictionary *FormatInfo(AudioDeviceID device)
{
  Float64 sampleRate = 0;
  GetValue(device, Address(kAudioDevicePropertyNominalSampleRate), sampleRate);

  UInt32 bitDepth = 0;
  BOOL isFloat = NO;
  auto streams = GetArray<AudioStreamID>(device, Address(kAudioDevicePropertyStreams, kAudioObjectPropertyScopeInput));
  if (!streams.empty()) {
    AudioStreamBasicDescription format = {};
    if (GetValue(streams.front(), Address(kAudioStreamPropertyPhysicalFormat), format)) {
      bitDepth = format.mBitsPerChannel;
      isFloat = (format.mFormatFlags & kAudioFormatFlagIsFloat) != 0;
    }
  }

  AudioDeviceID output = DefaultDevice(kAudioHardwarePropertyDefaultOutputDevice);
  Float64 outputRate = 0;
  NSString *outputName = nil;
  if (output != kAudioObjectUnknown) {
    GetValue(output, Address(kAudioDevicePropertyNominalSampleRate), outputRate);
    outputName = GetString(output, Address(kAudioObjectPropertyName));
  }

  return @{
    @"sampleRate" : @(sampleRate),
    @"availableSampleRates" : AvailableSampleRates(device),
    @"channels" : @(ChannelCount(device, kAudioObjectPropertyScopeInput)),
    @"bitDepth" : @(bitDepth),
    @"isFloat" : @(isFloat),
    @"outputDeviceName" : outputName ?: [NSNull null],
    @"outputSampleRate" : outputRate > 0 ? @(outputRate) : [NSNull null],
  };
}

NSDictionary *DeviceState()
{
  AudioDeviceID device = DefaultInputDevice();
  if (device == kAudioObjectUnknown) {
    return @{@"device" : [NSNull null], @"volume" : [NSNull null], @"format" : [NSNull null]};
  }
  return @{@"device" : DeviceInfo(device, device), @"volume" : VolumeInfo(device), @"format" : FormatInfo(device)};
}

#pragma mark - App identity helpers

NSCache<NSString *, NSString *> *IconCache()
{
  static NSCache<NSString *, NSString *> *cache;
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    cache = [NSCache new];
  });
  return cache;
}

NSString *IconDataURIForPath(NSString *path)
{
  if (path.length == 0) {
    return nil;
  }
  NSString *cached = [IconCache() objectForKey:path];
  if (cached) {
    return cached;
  }

  NSImage *icon = [[NSWorkspace sharedWorkspace] iconForFile:path];
  const NSInteger pixels = 64;
  NSBitmapImageRep *rep = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:NULL
                                                                  pixelsWide:pixels
                                                                  pixelsHigh:pixels
                                                               bitsPerSample:8
                                                             samplesPerPixel:4
                                                                    hasAlpha:YES
                                                                    isPlanar:NO
                                                              colorSpaceName:NSDeviceRGBColorSpace
                                                                 bytesPerRow:0
                                                                bitsPerPixel:0];
  if (!icon || !rep) {
    return nil;
  }
  [NSGraphicsContext saveGraphicsState];
  NSGraphicsContext.currentContext = [NSGraphicsContext graphicsContextWithBitmapImageRep:rep];
  [icon drawInRect:NSMakeRect(0, 0, pixels, pixels)
          fromRect:NSZeroRect
         operation:NSCompositingOperationSourceOver
          fraction:1];
  [NSGraphicsContext restoreGraphicsState];

  NSData *png = [rep representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
  if (!png) {
    return nil;
  }
  NSString *uri = [@"data:image/png;base64," stringByAppendingString:[png base64EncodedStringWithOptions:0]];
  [IconCache() setObject:uri forKey:path];
  return uri;
}

// Helper processes (e.g. "Google Chrome Helper") live inside their main app, so attribute them to the outermost .app.
NSString *OuterAppBundlePath(NSString *path)
{
  NSRange range = [path rangeOfString:@".app/"];
  if (range.location == NSNotFound) {
    return [path hasSuffix:@".app"] ? path : nil;
  }
  return [path substringToIndex:range.location + 4];
}

NSString *AppNameForBundlePath(NSString *path)
{
  NSBundle *bundle = [NSBundle bundleWithPath:path];
  for (NSString *key in @[ @"CFBundleDisplayName", @"CFBundleName" ]) {
    id name = [bundle objectForInfoDictionaryKey:key];
    if ([name isKindOfClass:[NSString class]] && [name length] > 0) {
      return name;
    }
  }
  return path.lastPathComponent.stringByDeletingPathExtension;
}

NSDictionary *ProcessIdentity(pid_t pid, NSString *bundleId)
{
  char pathBuffer[PROC_PIDPATHINFO_MAXSIZE] = {0};
  NSString *executable = nil;
  if (proc_pidpath(pid, pathBuffer, sizeof(pathBuffer)) > 0) {
    executable = [NSString stringWithUTF8String:pathBuffer];
  }

  NSString *bundlePath = executable ? OuterAppBundlePath(executable) : nil;
  if (bundlePath) {
    return @{@"name" : AppNameForBundlePath(bundlePath), @"icon" : IconDataURIForPath(bundlePath) ?: [NSNull null]};
  }

  NSRunningApplication *app = [NSRunningApplication runningApplicationWithProcessIdentifier:pid];
  if (app.localizedName.length > 0) {
    NSString *icon = app.bundleURL ? IconDataURIForPath(app.bundleURL.path) : nil;
    return @{@"name" : app.localizedName, @"icon" : icon ?: [NSNull null]};
  }

  char nameBuffer[2 * MAXCOMLEN + 1] = {0};
  NSString *name = nil;
  if (proc_name(pid, nameBuffer, sizeof(nameBuffer)) > 0) {
    name = [NSString stringWithUTF8String:nameBuffer];
  }
  name = name ?: executable.lastPathComponent ?: bundleId ?: [NSString stringWithFormat:@"Process %d", pid];
  return @{@"name" : name, @"icon" : [NSNull null]};
}

NSArray<NSDictionary *> *InputProcesses()
{
  NSMutableArray<NSDictionary *> *processes = [NSMutableArray new];
  if (@available(macOS 14.0, *)) {
    pid_t selfPid = getpid();
    for (AudioObjectID process :
         GetArray<AudioObjectID>(kAudioObjectSystemObject, Address(kAudioHardwarePropertyProcessObjectList))) {
      UInt32 runningInput = 0;
      GetValue(process, Address(kAudioProcessPropertyIsRunningInput), runningInput);
      if (!runningInput) {
        continue;
      }
      pid_t pid = 0;
      GetValue(process, Address(kAudioProcessPropertyPID), pid);
      NSString *bundleId = GetString(process, Address(kAudioProcessPropertyBundleID));

      NSMutableArray<NSString *> *deviceNames = [NSMutableArray new];
      for (AudioObjectID device : GetArray<AudioObjectID>(
               process, Address(kAudioProcessPropertyDevices, kAudioObjectPropertyScopeInput))) {
        NSString *deviceName = GetString(device, Address(kAudioObjectPropertyName));
        if (deviceName) {
          [deviceNames addObject:deviceName];
        }
      }

      NSDictionary *identity = ProcessIdentity(pid, bundleId);
      [processes addObject:@{
        @"pid" : @(pid),
        @"bundleId" : bundleId.length > 0 ? bundleId : [NSNull null],
        @"name" : identity[@"name"],
        @"icon" : identity[@"icon"],
        @"devices" : deviceNames,
        @"isSelf" : @(pid == selfPid),
      }];
    }
  }
  return processes;
}

#pragma mark - Permission helpers

NSString *AuthorizationName(AVAuthorizationStatus status)
{
  switch (status) {
    case AVAuthorizationStatusAuthorized:
      return @"authorized";
    case AVAuthorizationStatusDenied:
      return @"denied";
    case AVAuthorizationStatusRestricted:
      return @"restricted";
    default:
      return @"notDetermined";
  }
}

NSDictionary *PermissionEntry(NSString *client, int clientType, int authValue, sqlite3_int64 lastModified)
{
  BOOL isPath = clientType == 1;
  NSString *bundlePath = isPath
      ? OuterAppBundlePath(client)
      : [[NSWorkspace sharedWorkspace] URLForApplicationWithBundleIdentifier:client].path;
  NSString *name = bundlePath ? AppNameForBundlePath(bundlePath) : (isPath ? client.lastPathComponent : client);
  return @{
    @"client" : client,
    @"isPath" : @(isPath),
    @"name" : name ?: client,
    @"icon" : IconDataURIForPath(bundlePath) ?: [NSNull null],
    // auth_value: 0 = denied, 1 = unknown, 2 = allowed, 3 = limited
    @"allowed" : @(authValue >= 2),
    @"installed" : @(isPath || bundlePath != nil),
    @"lastModified" : @(lastModified),
  };
}

// Reading the user TCC database requires Full Disk Access; without it open() fails with EPERM.
NSDictionary *MicrophonePermissionsFromTCC()
{
  NSString *path =
      [NSHomeDirectory() stringByAppendingPathComponent:@"Library/Application Support/com.apple.TCC/TCC.db"];
  int fd = open(path.fileSystemRepresentation, O_RDONLY);
  if (fd < 0) {
    BOOL blocked = errno == EPERM || errno == EACCES;
    return @{
      @"fullDiskAccess" : @NO,
      @"apps" : @[],
      @"error" : blocked ? [NSNull null] : @(strerror(errno)),
    };
  }
  close(fd);

  sqlite3 *db = nullptr;
  if (sqlite3_open_v2(path.fileSystemRepresentation, &db, SQLITE_OPEN_READONLY, nullptr) != SQLITE_OK) {
    NSString *message = db ? @(sqlite3_errmsg(db)) : @"Could not open the privacy database.";
    sqlite3_close(db);
    return @{@"fullDiskAccess" : @YES, @"apps" : @[], @"error" : message};
  }

  const char *query = "SELECT client, client_type, auth_value, last_modified FROM access "
                      "WHERE service = 'kTCCServiceMicrophone' ORDER BY last_modified DESC";
  sqlite3_stmt *statement = nullptr;
  if (sqlite3_prepare_v2(db, query, -1, &statement, nullptr) != SQLITE_OK) {
    NSString *message = @(sqlite3_errmsg(db));
    sqlite3_close(db);
    return @{@"fullDiskAccess" : @YES, @"apps" : @[], @"error" : message};
  }

  NSMutableArray<NSDictionary *> *apps = [NSMutableArray new];
  while (sqlite3_step(statement) == SQLITE_ROW) {
    const unsigned char *client = sqlite3_column_text(statement, 0);
    if (!client) {
      continue;
    }
    [apps addObject:PermissionEntry(
                        @((const char *)client),
                        sqlite3_column_int(statement, 1),
                        sqlite3_column_int(statement, 2),
                        sqlite3_column_int64(statement, 3))];
  }
  sqlite3_finalize(statement);
  sqlite3_close(db);
  return @{@"fullDiskAccess" : @YES, @"apps" : apps, @"error" : [NSNull null]};
}

#pragma mark - Process helpers

void RunTask(NSString *launchPath, NSArray<NSString *> *arguments, void (^completion)(int status, NSString *output))
{
  NSTask *task = [NSTask new];
  task.executableURL = [NSURL fileURLWithPath:launchPath];
  task.arguments = arguments;
  NSPipe *pipe = [NSPipe pipe];
  task.standardOutput = pipe;
  task.standardError = pipe;
  task.terminationHandler = ^(NSTask *finished) {
    NSData *data = [pipe.fileHandleForReading readDataToEndOfFile];
    NSString *output = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] ?: @"";
    completion(
        finished.terminationStatus,
        [output stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]]);
  };
  NSError *error = nil;
  if (![task launchAndReturnError:&error]) {
    completion(-1, error.localizedDescription ?: @"Could not start the process.");
  }
}

NSString *ShellQuoted(NSString *value)
{
  return [NSString stringWithFormat:@"'%@'", [value stringByReplacingOccurrencesOfString:@"'" withString:@"'\\''"]];
}

NSString *AppleScriptQuoted(NSString *value)
{
  NSString *escaped = [[value stringByReplacingOccurrencesOfString:@"\\" withString:@"\\\\"]
      stringByReplacingOccurrencesOfString:@"\""
                                withString:@"\\\""];
  return [NSString stringWithFormat:@"\"%@\"", escaped];
}

#pragma mark - Audio reset helper

// Root-owned script that sudo runs without a password (see kSudoersPath), so the app can gate it with Touch ID
// instead of the admin password dialog. It must not act on anything the caller controls beyond the one flag.
// Disabled drivers move outside HAL/, where coreaudiod no longer loads them but they are easy to restore.
NSString *const kResetAudioScript = @R"(#!/bin/sh
# Installed by Mac Mic Fixer. Runs as root via sudo without a password.
set -eu
PATH=/usr/bin:/bin:/usr/sbin:/sbin
case "${1-}" in
"") ;;
--disable-conflicting-drivers)
  hal="/Library/Audio/Plug-Ins/HAL"
  disabled="/Library/Audio/Plug-Ins/Disabled by Mac Mic Fixer"
  for name in "Background Music Device.driver" "BGMDriver.driver"; do
    if [ -e "$hal/$name" ]; then
      mkdir -p "$disabled"
      rm -rf "$disabled/$name"
      mv "$hal/$name" "$disabled/$name"
      echo "$name"
    fi
  done
  ;;
*)
  echo "usage: $0 [--disable-conflicting-drivers]" >&2
  exit 64
  ;;
esac
killall coreaudiod
)";
NSString *const kResetAudioHelperPath = @"/Library/PrivilegedHelperTools/com.macmicfixer.reset-audio";
NSString *const kSudoersPath = @"/etc/sudoers.d/mac-mic-fixer";
NSString *const kDisableDriversFlag = @"--disable-conflicting-drivers";

// Also false when an older app version installed a different script, so the password path reinstalls it.
BOOL ResetAudioHelperInstalled()
{
  NSString *installed = [NSString stringWithContentsOfFile:kResetAudioHelperPath encoding:NSUTF8StringEncoding error:nil];
  return [installed isEqualToString:kResetAudioScript] &&
      [[NSFileManager defaultManager] fileExistsAtPath:kSudoersPath];
}

// Shell commands, run as root, that install the helper and its sudoers rule for the current user.
NSArray<NSString *> *InstallResetAudioHelperCommands()
{
  NSString *user = NSUserName();
  NSCharacterSet *invalid =
      [[NSCharacterSet characterSetWithCharactersInString:
                           @"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-_"] invertedSet];
  if (user.length == 0 || [user rangeOfCharacterFromSet:invalid].location != NSNotFound) {
    return @[];
  }
  NSString *rule = [NSString stringWithFormat:
                                 @"# Installed by Mac Mic Fixer: lets %@ restart the audio service without a password.\n"
                                 @"%@ ALL=(root) NOPASSWD: %@\n",
                                 user, user, kResetAudioHelperPath];
  // sudo ignores files in sudoers.d whose name contains a dot, so the rule is inert until visudo accepts it.
  NSString *helperTemp = [kResetAudioHelperPath stringByAppendingString:@".tmp"];
  NSString *sudoersTemp = [kSudoersPath stringByAppendingString:@".tmp"];
  return @[
    @"umask 022",
    [NSString stringWithFormat:@"/usr/bin/printf %%s %@ > %@", ShellQuoted(kResetAudioScript), ShellQuoted(helperTemp)],
    [NSString stringWithFormat:@"/usr/sbin/chown root:wheel %@", ShellQuoted(helperTemp)],
    [NSString stringWithFormat:@"/bin/chmod 755 %@", ShellQuoted(helperTemp)],
    [NSString stringWithFormat:@"/bin/mv -f %@ %@", ShellQuoted(helperTemp), ShellQuoted(kResetAudioHelperPath)],
    [NSString stringWithFormat:@"/usr/bin/printf %%s %@ > %@", ShellQuoted(rule), ShellQuoted(sudoersTemp)],
    [NSString stringWithFormat:@"/usr/sbin/chown root:wheel %@", ShellQuoted(sudoersTemp)],
    [NSString stringWithFormat:@"/bin/chmod 440 %@", ShellQuoted(sudoersTemp)],
    [NSString stringWithFormat:@"/usr/sbin/visudo -cqf %@", ShellQuoted(sudoersTemp)],
    [NSString stringWithFormat:@"/bin/mv -f %@ %@", ShellQuoted(sudoersTemp), ShellQuoted(kSudoersPath)],
  ];
}

NSArray<NSString *> *OutputLines(NSString *output)
{
  NSMutableArray<NSString *> *lines = [NSMutableArray new];
  for (NSString *line in [output componentsSeparatedByCharactersInSet:[NSCharacterSet newlineCharacterSet]]) {
    if (line.length > 0) {
      [lines addObject:line];
    }
  }
  return lines;
}

void QuitConflictingDriverApps()
{
  dispatch_sync(dispatch_get_main_queue(), ^{
    for (NSRunningApplication *app in
         [NSRunningApplication runningApplicationsWithBundleIdentifier:@"com.bearisdriving.BGM.App"]) {
      [app terminate];
    }
  });
}

double ToDecibels(double amplitude)
{
  return amplitude > 0 ? std::max(20 * std::log10(amplitude), kLevelFloorDb) : kLevelFloorDb;
}

struct ListenerRegistration {
  AudioObjectID object;
  AudioObjectPropertyAddress address;
  AudioObjectPropertyListenerBlock block;
};

} // namespace

#pragma mark - Module

@implementation MicDiagnostics {
  dispatch_queue_t _queue;
  BOOL _hasListeners;
  NSMutableSet<NSString *> *_pendingEvents;
  std::vector<ListenerRegistration> _systemListeners;
  std::vector<ListenerRegistration> _deviceListeners;
  AudioDeviceID _observedDevice;

  AVAudioEngine *_engine;
  id _engineConfigurationObserver;
  BOOL _meterRequested;

  // Only touched from the audio tap thread while the engine runs.
  double _sumSquares;
  UInt64 _sampleCount;
  float _peak;
  std::vector<float> _channelPeaks;
  CFAbsoluteTime _lastLevelEmit;
}

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (instancetype)init
{
  if (self = [super init]) {
    _queue = dispatch_queue_create("com.macmicfixer.diagnostics", DISPATCH_QUEUE_SERIAL);
    _pendingEvents = [NSMutableSet new];
    _observedDevice = kAudioObjectUnknown;
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(popoverVisibilityDidChange:)
                                                 name:MMFPopoverVisibilityDidChangeNotification
                                               object:nil];
  }
  return self;
}

- (dispatch_queue_t)methodQueue
{
  return _queue;
}

- (NSArray<NSString *> *)supportedEvents
{
  return @[
    kDevicesChangedEvent, kDeviceStateChangedEvent, kLevelEvent, kLevelMeterErrorEvent, kPopoverVisibilityEvent
  ];
}

- (void)startObserving
{
  _hasListeners = YES;
  [self installSystemListeners];
  [self observeDevice:DefaultInputDevice()];
}

- (void)stopObserving
{
  _hasListeners = NO;
  [self unregisterListeners:_systemListeners];
  [self unregisterListeners:_deviceListeners];
  _observedDevice = kAudioObjectUnknown;
}

- (void)invalidate
{
  [[NSNotificationCenter defaultCenter] removeObserver:self];
  dispatch_async(_queue, ^{
    self->_meterRequested = NO;
    [self tearDownEngine];
    [super invalidate];
    [self unregisterListeners:self->_systemListeners];
    [self unregisterListeners:self->_deviceListeners];
  });
}

- (void)sendEventIfObserved:(NSString *)name body:(id)body
{
  if (_hasListeners) {
    [self sendEventWithName:name body:body];
  }
}

- (void)popoverVisibilityDidChange:(NSNotification *)notification
{
  BOOL visible = [notification.userInfo[@"visible"] boolValue];
  dispatch_async(_queue, ^{
    [self sendEventIfObserved:kPopoverVisibilityEvent body:@{@"visible" : @(visible)}];
  });
}

#pragma mark - Hardware listeners

- (void)addListenerTo:(AudioObjectID)object
              address:(AudioObjectPropertyAddress)address
                 into:(std::vector<ListenerRegistration> &)registrations
              handler:(dispatch_block_t)handler
{
  AudioObjectPropertyListenerBlock block = ^(UInt32, const AudioObjectPropertyAddress *) {
    handler();
  };
  if (AudioObjectAddPropertyListenerBlock(object, &address, _queue, block) == noErr) {
    registrations.push_back({object, address, block});
  }
}

- (void)unregisterListeners:(std::vector<ListenerRegistration> &)registrations
{
  for (auto &registration : registrations) {
    AudioObjectRemovePropertyListenerBlock(registration.object, &registration.address, _queue, registration.block);
  }
  registrations.clear();
}

- (void)installSystemListeners
{
  [self unregisterListeners:_systemListeners];
  __weak MicDiagnostics *weakSelf = self;
  dispatch_block_t handler = ^{
    [weakSelf handleHardwareChange];
  };
  const AudioObjectPropertySelector selectors[] = {
      kAudioHardwarePropertyDevices,
      kAudioHardwarePropertyDefaultInputDevice,
      kAudioHardwarePropertyDefaultOutputDevice,
  };
  for (AudioObjectPropertySelector selector : selectors) {
    [self addListenerTo:kAudioObjectSystemObject address:Address(selector) into:_systemListeners handler:handler];
  }
}

- (void)observeDevice:(AudioDeviceID)device
{
  [self unregisterListeners:_deviceListeners];
  _observedDevice = device;
  if (device == kAudioObjectUnknown) {
    return;
  }

  __weak MicDiagnostics *weakSelf = self;
  dispatch_block_t handler = ^{
    [weakSelf scheduleEvent:kDeviceStateChangedEvent];
  };
  const AudioObjectPropertySelector globalSelectors[] = {
      kAudioDevicePropertyDeviceIsAlive,
      kAudioDevicePropertyDeviceIsRunningSomewhere,
      kAudioDevicePropertyNominalSampleRate,
  };
  for (AudioObjectPropertySelector selector : globalSelectors) {
    [self addListenerTo:device address:Address(selector) into:_deviceListeners handler:handler];
  }
  [self addListenerTo:device
              address:Address(kAudioDevicePropertyStreamConfiguration, kAudioObjectPropertyScopeInput)
                 into:_deviceListeners
              handler:handler];
  const AudioObjectPropertySelector controlSelectors[] = {kAudioDevicePropertyVolumeScalar, kAudioDevicePropertyMute};
  for (AudioObjectPropertySelector selector : controlSelectors) {
    for (auto element : ElementsWithProperty(device, selector, kAudioObjectPropertyScopeInput)) {
      [self addListenerTo:device
                  address:Address(selector, kAudioObjectPropertyScopeInput, element)
                     into:_deviceListeners
                  handler:handler];
    }
  }
}

- (void)handleHardwareChange
{
  AudioDeviceID current = DefaultInputDevice();
  if (current != _observedDevice) {
    [self observeDevice:current];
  }
  [self scheduleEvent:kDevicesChangedEvent];
  [self scheduleEvent:kDeviceStateChangedEvent];
}

// CoreAudio fires bursts of notifications; coalesce them so JS refetches once.
- (void)scheduleEvent:(NSString *)name
{
  if ([_pendingEvents containsObject:name]) {
    return;
  }
  [_pendingEvents addObject:name];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC), _queue, ^{
    [self->_pendingEvents removeObject:name];
    [self sendEventIfObserved:name body:nil];
  });
}

- (void)refreshAfterAudioServiceRestart
{
  if (_hasListeners) {
    [self installSystemListeners];
    [self observeDevice:DefaultInputDevice()];
  }
  [self scheduleEvent:kDevicesChangedEvent];
  [self scheduleEvent:kDeviceStateChangedEvent];
  if (_meterRequested) {
    [self restartEngineAfterDelay];
  }
}

#pragma mark - Devices, volume and format

RCT_EXPORT_METHOD(getInputDevices : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  AudioDeviceID defaultInput = DefaultInputDevice();
  NSMutableArray<NSDictionary *> *devices = [NSMutableArray new];
  for (AudioDeviceID device : InputDevices()) {
    [devices addObject:DeviceInfo(device, defaultInput)];
  }
  resolve(devices);
}

RCT_EXPORT_METHOD(getDeviceState : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  resolve(DeviceState());
}

RCT_EXPORT_METHOD(setDefaultInput
                  : (double)deviceId resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)
{
  OSStatus status = SetValue(
      kAudioObjectSystemObject, Address(kAudioHardwarePropertyDefaultInputDevice), (AudioDeviceID)deviceId);
  if (status != noErr) {
    reject(@"set_default_failed", [NSString stringWithFormat:@"macOS refused to switch the input device (%@).", StatusString(status)], nil);
    return;
  }
  resolve(nil);
}

RCT_EXPORT_METHOD(setInputVolume
                  : (double)volume resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)
{
  AudioDeviceID device = DefaultInputDevice();
  if (device == kAudioObjectUnknown) {
    reject(@"no_device", @"There is no input device.", nil);
    return;
  }
  Float32 value = (Float32)std::clamp(volume, 0.0, 1.0);
  bool changed = false;
  OSStatus lastStatus = noErr;
  for (auto element : ElementsWithProperty(device, kAudioDevicePropertyVolumeScalar, kAudioObjectPropertyScopeInput)) {
    auto address = Address(kAudioDevicePropertyVolumeScalar, kAudioObjectPropertyScopeInput, element);
    if (!IsSettable(device, address)) {
      continue;
    }
    lastStatus = SetValue(device, address, value);
    changed = changed || lastStatus == noErr;
  }
  if (!changed) {
    NSString *message = lastStatus != noErr
        ? [NSString stringWithFormat:@"Setting the input volume failed (%@).", StatusString(lastStatus)]
        : @"This device does not let macOS change its input volume.";
    reject(@"not_supported", message, nil);
    return;
  }
  resolve(VolumeInfo(device));
}

RCT_EXPORT_METHOD(setInputMuted
                  : (BOOL)muted resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)
{
  AudioDeviceID device = DefaultInputDevice();
  if (device == kAudioObjectUnknown) {
    reject(@"no_device", @"There is no input device.", nil);
    return;
  }
  bool changed = false;
  OSStatus lastStatus = noErr;
  for (auto element : ElementsWithProperty(device, kAudioDevicePropertyMute, kAudioObjectPropertyScopeInput)) {
    auto address = Address(kAudioDevicePropertyMute, kAudioObjectPropertyScopeInput, element);
    if (!IsSettable(device, address)) {
      continue;
    }
    lastStatus = SetValue(device, address, (UInt32)(muted ? 1 : 0));
    changed = changed || lastStatus == noErr;
  }
  if (!changed) {
    NSString *message = lastStatus != noErr
        ? [NSString stringWithFormat:@"Changing mute failed (%@).", StatusString(lastStatus)]
        : @"This device has no mute control macOS can change.";
    reject(@"not_supported", message, nil);
    return;
  }
  resolve(VolumeInfo(device));
}

RCT_EXPORT_METHOD(setSampleRate
                  : (double)sampleRate resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)
{
  AudioDeviceID device = DefaultInputDevice();
  if (device == kAudioObjectUnknown) {
    reject(@"no_device", @"There is no input device.", nil);
    return;
  }
  OSStatus status = SetValue(device, Address(kAudioDevicePropertyNominalSampleRate), (Float64)sampleRate);
  if (status != noErr) {
    reject(@"set_rate_failed", [NSString stringWithFormat:@"The device rejected %.0f Hz (%@).", sampleRate, StatusString(status)], nil);
    return;
  }
  resolve(nil);
}

#pragma mark - Apps using the microphone and permissions

RCT_EXPORT_METHOD(getInputProcesses : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  resolve(InputProcesses());
}

RCT_EXPORT_METHOD(getPermissions : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  NSMutableDictionary *result = [MicrophonePermissionsFromTCC() mutableCopy];
  result[@"self"] = AuthorizationName([AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio]);
  resolve(result);
}

RCT_EXPORT_METHOD(requestMicrophonePermission
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)
{
  [AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio
                           completionHandler:^(BOOL granted) {
                             resolve(AuthorizationName(
                                 [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio]));
                           }];
}

RCT_EXPORT_METHOD(resetAppPermission
                  : (NSString *)bundleId resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)
{
  NSCharacterSet *invalid =
      [[NSCharacterSet characterSetWithCharactersInString:
                           @"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-_"] invertedSet];
  if (bundleId.length == 0 || [bundleId rangeOfCharacterFromSet:invalid].location != NSNotFound) {
    reject(@"invalid_bundle_id", @"Only apps with a bundle identifier can be reset.", nil);
    return;
  }
  RunTask(@"/usr/bin/tccutil", @[ @"reset", @"Microphone", bundleId ], ^(int status, NSString *output) {
    if (status != 0) {
      reject(@"reset_failed", output.length > 0 ? output : @"tccutil failed.", nil);
      return;
    }
    resolve(nil);
  });
}

#pragma mark - Level meter

RCT_EXPORT_METHOD(startLevelMeter : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  _meterRequested = YES;
  AVAuthorizationStatus status = [AVCaptureDevice authorizationStatusForMediaType:AVMediaTypeAudio];
  if (status == AVAuthorizationStatusNotDetermined) {
    [AVCaptureDevice requestAccessForMediaType:AVMediaTypeAudio
                             completionHandler:^(BOOL granted) {
                               dispatch_async(self->_queue, ^{
                                 [self startLevelMeterWithPermission:granted resolve:resolve reject:reject];
                               });
                             }];
    return;
  }
  [self startLevelMeterWithPermission:status == AVAuthorizationStatusAuthorized resolve:resolve reject:reject];
}

- (void)startLevelMeterWithPermission:(BOOL)granted
                              resolve:(RCTPromiseResolveBlock)resolve
                               reject:(RCTPromiseRejectBlock)reject
{
  if (!granted) {
    reject(@"permission_denied", @"Mac Mic Fixer is not allowed to use the microphone.", nil);
    return;
  }
  if (!_meterRequested) {
    resolve(nil);
    return;
  }
  NSError *error = nil;
  if (![self startEngine:&error]) {
    reject(@"engine_failed", error.localizedDescription ?: @"Could not open the input device.", error);
    return;
  }
  resolve(nil);
}

RCT_EXPORT_METHOD(stopLevelMeter : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  _meterRequested = NO;
  [self tearDownEngine];
  resolve(nil);
}

- (BOOL)startEngine:(NSError **)error
{
  if (_engine.isRunning) {
    return YES;
  }
  [self tearDownEngine];

  AVAudioEngine *engine = [AVAudioEngine new];
  AVAudioInputNode *input = engine.inputNode;
  AVAudioFormat *format = [input outputFormatForBus:0];
  if (format.sampleRate <= 0 || format.channelCount == 0) {
    if (error) {
      *error = [NSError errorWithDomain:@"MicDiagnostics"
                                   code:1
                               userInfo:@{NSLocalizedDescriptionKey : @"The input device reports no usable audio format."}];
    }
    return NO;
  }

  _sumSquares = 0;
  _sampleCount = 0;
  _peak = 0;
  _channelPeaks.assign(std::min<size_t>(format.channelCount, kMaxMeteredChannels), 0);
  _lastLevelEmit = 0;

  __weak MicDiagnostics *weakSelf = self;
  [input installTapOnBus:0
              bufferSize:1024
                  format:format
                   block:^(AVAudioPCMBuffer *buffer, AVAudioTime *when) {
                     [weakSelf processBuffer:buffer];
                   }];
  [engine prepare];
  if (![engine startAndReturnError:error]) {
    [input removeTapOnBus:0];
    return NO;
  }

  _engine = engine;
  _engineConfigurationObserver = [[NSNotificationCenter defaultCenter]
      addObserverForName:AVAudioEngineConfigurationChangeNotification
                  object:engine
                   queue:nil
              usingBlock:^(NSNotification *notification) {
                MicDiagnostics *strongSelf = weakSelf;
                if (strongSelf) {
                  dispatch_async(strongSelf->_queue, ^{
                    [strongSelf restartEngineAfterDelay];
                  });
                }
              }];
  return YES;
}

- (void)tearDownEngine
{
  if (_engineConfigurationObserver) {
    [[NSNotificationCenter defaultCenter] removeObserver:_engineConfigurationObserver];
    _engineConfigurationObserver = nil;
  }
  if (_engine) {
    [_engine.inputNode removeTapOnBus:0];
    [_engine stop];
    _engine = nil;
  }
}

// The engine stops when the default input changes or coreaudiod restarts; reopen whatever is now the default.
- (void)restartEngineAfterDelay
{
  [self tearDownEngine];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 300 * NSEC_PER_MSEC), _queue, ^{
    if (!self->_meterRequested || self->_engine) {
      return;
    }
    NSError *error = nil;
    if (![self startEngine:&error]) {
      [self sendEventIfObserved:kLevelMeterErrorEvent
                           body:@{@"message" : error.localizedDescription ?: @"Could not reopen the input device."}];
    }
  });
}

- (void)processBuffer:(AVAudioPCMBuffer *)buffer
{
  float *const *channelData = buffer.floatChannelData;
  if (!channelData) {
    return;
  }
  const AVAudioFrameCount frames = buffer.frameLength;
  const NSUInteger stride = buffer.stride;
  const size_t channels = std::min<size_t>(buffer.format.channelCount, _channelPeaks.size());
  const bool interleaved = buffer.format.isInterleaved;

  for (size_t channel = 0; channel < channels; channel++) {
    float channelPeak = _channelPeaks[channel];
    for (AVAudioFrameCount frame = 0; frame < frames; frame++) {
      float sample = interleaved ? channelData[0][frame * stride + channel] : channelData[channel][frame * stride];
      float magnitude = std::fabs(sample);
      _sumSquares += (double)sample * sample;
      channelPeak = std::max(channelPeak, magnitude);
    }
    _channelPeaks[channel] = channelPeak;
    _peak = std::max(_peak, channelPeak);
  }
  _sampleCount += (UInt64)frames * channels;

  CFAbsoluteTime now = CFAbsoluteTimeGetCurrent();
  if (now - _lastLevelEmit < kLevelEmitInterval || _sampleCount == 0) {
    return;
  }
  _lastLevelEmit = now;

  NSMutableArray<NSNumber *> *channelLevels = [NSMutableArray arrayWithCapacity:channels];
  for (size_t channel = 0; channel < channels; channel++) {
    [channelLevels addObject:@(ToDecibels(_channelPeaks[channel]))];
    _channelPeaks[channel] = 0;
  }
  NSDictionary *body = @{
    @"rms" : @(ToDecibels(std::sqrt(_sumSquares / (double)_sampleCount))),
    @"peak" : @(ToDecibels(_peak)),
    @"silent" : @(_peak == 0),
    @"channels" : channelLevels,
  };
  _sumSquares = 0;
  _sampleCount = 0;
  _peak = 0;
  [self sendEventIfObserved:kLevelEvent body:body];
}

#pragma mark - Fixes

RCT_EXPORT_METHOD(restartCoreAudio
                  : (BOOL)disableConflictingDrivers resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)
{
  if (disableConflictingDrivers) {
    QuitConflictingDriverApps();
  }
  NSArray<NSString *> *arguments = disableConflictingDrivers ? @[ kDisableDriversFlag ] : @[];
  if (ResetAudioHelperInstalled()) {
    [self restartCoreAudioWithTouchID:arguments resolve:resolve reject:reject];
  } else {
    [self restartCoreAudioWithPassword:arguments resolve:resolve reject:reject];
  }
}

// Prefers the Touch ID–only sheet; the macOS password dialog only appears via "Use Password…" or without Touch ID.
- (void)authenticate:(NSString *)reason completion:(void (^)(BOOL success, NSError *error))completion
{
  LAContext *context = [LAContext new];
  LAPolicy biometrics = LAPolicyDeviceOwnerAuthenticationWithBiometricsOrWatch;
  if (![context canEvaluatePolicy:biometrics error:nil]) {
    [context evaluatePolicy:LAPolicyDeviceOwnerAuthentication localizedReason:reason reply:completion];
    return;
  }
  context.localizedFallbackTitle = @"Use Password…";
  [context evaluatePolicy:biometrics
          localizedReason:reason
                    reply:^(BOOL success, NSError *error) {
                      if (!success && error.code == LAErrorUserFallback) {
                        [[LAContext new] evaluatePolicy:LAPolicyDeviceOwnerAuthentication
                                        localizedReason:reason
                                                  reply:completion];
                        return;
                      }
                      completion(success, error);
                    }];
}

- (void)restartCoreAudioWithTouchID:(NSArray<NSString *> *)arguments
                            resolve:(RCTPromiseResolveBlock)resolve
                             reject:(RCTPromiseRejectBlock)reject
{
  [self authenticate:@"restart the macOS audio service"
          completion:^(BOOL success, NSError *error) {
            dispatch_async(self->_queue, ^{
              if (!success) {
                BOOL cancelled = error.code == LAErrorUserCancel || error.code == LAErrorAppCancel ||
                    error.code == LAErrorSystemCancel;
                reject(
                    cancelled ? @"cancelled" : @"auth_failed",
                    cancelled ? @"Restart cancelled." : error.localizedDescription,
                    error);
                return;
              }
              NSArray<NSString *> *sudoArguments =
                  [@[ @"-n", kResetAudioHelperPath ] arrayByAddingObjectsFromArray:arguments];
              RunTask(@"/usr/bin/sudo", sudoArguments, ^(int status, NSString *output) {
                dispatch_async(self->_queue, ^{
                  if (status == 0) {
                    [self finishCoreAudioRestart:output resolve:resolve];
                  } else if ([output containsString:@"password is required"]) {
                    // The sudoers rule is gone; reinstall it with the admin password.
                    [self restartCoreAudioWithPassword:arguments resolve:resolve reject:reject];
                  } else {
                    reject(@"restart_failed", output.length > 0 ? output : @"Restarting coreaudiod failed.", nil);
                  }
                });
              });
            });
          }];
}

// Installs the helper (so later restarts can use Touch ID) and runs it, behind one admin password prompt.
- (void)restartCoreAudioWithPassword:(NSArray<NSString *> *)arguments
                             resolve:(RCTPromiseResolveBlock)resolve
                              reject:(RCTPromiseRejectBlock)reject
{
  NSMutableArray<NSString *> *commands = [InstallResetAudioHelperCommands() mutableCopy];
  BOOL installing = commands.count > 0;
  NSMutableArray<NSString *> *run = [@[ installing ? kResetAudioHelperPath : @"/bin/sh -c " ] mutableCopy];
  if (!installing) {
    [run addObject:[ShellQuoted(kResetAudioScript) stringByAppendingString:@" sh"]];
  }
  for (NSString *argument in arguments) {
    [run addObject:ShellQuoted(argument)];
  }
  [commands addObject:[run componentsJoinedByString:@" "]];

  NSString *prompt = installing
      ? @"Mac Mic Fixer wants to restart the macOS audio service (coreaudiod) and set up Touch ID for future restarts."
      : @"Mac Mic Fixer wants to restart the macOS audio service (coreaudiod).";
  NSString *script = [NSString
      stringWithFormat:@"do shell script %@ with prompt %@ with administrator privileges without altering line endings",
                       AppleScriptQuoted([commands componentsJoinedByString:@" && "]),
                       AppleScriptQuoted(prompt)];
  RunTask(@"/usr/bin/osascript", @[ @"-e", script ], ^(int status, NSString *output) {
    dispatch_async(self->_queue, ^{
      if (status != 0) {
        BOOL cancelled = [output containsString:@"-128"];
        reject(
            cancelled ? @"cancelled" : @"restart_failed",
            cancelled ? @"Restart cancelled." : (output.length > 0 ? output : @"Restarting coreaudiod failed."),
            nil);
        return;
      }
      [self finishCoreAudioRestart:output resolve:resolve];
    });
  });
}

// Resolves with the drivers the helper disabled, which it prints one per line.
- (void)finishCoreAudioRestart:(NSString *)output resolve:(RCTPromiseResolveBlock)resolve
{
  // launchd relaunches coreaudiod right away; give it a moment before reading the hardware again.
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 2 * NSEC_PER_SEC), _queue, ^{
    [self refreshAfterAudioServiceRestart];
    resolve(OutputLines(output));
  });
}

RCT_EXPORT_METHOD(reselectDefaultInput : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  AudioDeviceID current = DefaultInputDevice();
  if (current == kAudioObjectUnknown) {
    reject(@"no_device", @"There is no input device to re-select.", nil);
    return;
  }

  AudioDeviceID alternative = kAudioObjectUnknown;
  for (AudioDeviceID device : InputDevices()) {
    UInt32 alive = 1;
    GetValue(device, Address(kAudioDevicePropertyDeviceIsAlive), alive);
    if (device == current || !alive) {
      continue;
    }
    UInt32 transport = 0;
    GetValue(device, Address(kAudioDevicePropertyTransportType), transport);
    if (alternative == kAudioObjectUnknown || transport == kAudioDeviceTransportTypeBuiltIn) {
      alternative = device;
    }
  }
  if (alternative == kAudioObjectUnknown) {
    reject(@"no_alternative", @"Re-selecting needs a second input device, but only one is connected.", nil);
    return;
  }

  auto defaultInput = Address(kAudioHardwarePropertyDefaultInputDevice);
  OSStatus status = SetValue(kAudioObjectSystemObject, defaultInput, alternative);
  if (status != noErr) {
    reject(@"set_default_failed", [NSString stringWithFormat:@"Switching input failed (%@).", StatusString(status)], nil);
    return;
  }
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 750 * NSEC_PER_MSEC), _queue, ^{
    OSStatus restoreStatus = SetValue(kAudioObjectSystemObject, defaultInput, current);
    if (restoreStatus != noErr) {
      reject(@"set_default_failed", [NSString stringWithFormat:@"Switching back failed (%@).", StatusString(restoreStatus)], nil);
      return;
    }
    resolve(nil);
  });
}

RCT_EXPORT_METHOD(resetInputVolume : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  AudioDeviceID device = DefaultInputDevice();
  if (device == kAudioObjectUnknown) {
    reject(@"no_device", @"There is no input device.", nil);
    return;
  }
  bool unmuted = false;
  for (auto element : ElementsWithProperty(device, kAudioDevicePropertyMute, kAudioObjectPropertyScopeInput)) {
    auto address = Address(kAudioDevicePropertyMute, kAudioObjectPropertyScopeInput, element);
    if (IsSettable(device, address) && SetValue(device, address, (UInt32)0) == noErr) {
      unmuted = true;
    }
  }
  bool volumeSet = false;
  for (auto element : ElementsWithProperty(device, kAudioDevicePropertyVolumeScalar, kAudioObjectPropertyScopeInput)) {
    auto address = Address(kAudioDevicePropertyVolumeScalar, kAudioObjectPropertyScopeInput, element);
    if (IsSettable(device, address) && SetValue(device, address, (Float32)0.75) == noErr) {
      volumeSet = true;
    }
  }
  resolve(@{@"unmuted" : @(unmuted), @"volumeSet" : @(volumeSet)});
}

RCT_EXPORT_METHOD(resetLevelMeter : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  [self tearDownEngine];
  if (!_meterRequested) {
    resolve(nil);
    return;
  }
  NSError *error = nil;
  if (![self startEngine:&error]) {
    reject(@"engine_failed", error.localizedDescription ?: @"Could not reopen the input device.", error);
    return;
  }
  resolve(nil);
}

RCT_EXPORT_METHOD(openAudioMidiSetup : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  NSURL *url = [[NSWorkspace sharedWorkspace] URLForApplicationWithBundleIdentifier:@"com.apple.audio.AudioMIDISetup"];
  if (!url) {
    reject(@"not_found", @"Audio MIDI Setup could not be found.", nil);
    return;
  }
  [[NSWorkspace sharedWorkspace] openApplicationAtURL:url
                                        configuration:[NSWorkspaceOpenConfiguration configuration]
                                    completionHandler:^(NSRunningApplication *app, NSError *error) {
                                      if (error) {
                                        reject(@"open_failed", error.localizedDescription, error);
                                        return;
                                      }
                                      resolve(nil);
                                    }];
}

#pragma mark - App shell

RCT_EXPORT_METHOD(setStatusIcon : (NSString *)kind toolTip : (NSString *)toolTip)
{
  [[NSNotificationCenter defaultCenter] postNotificationName:MMFStatusIconDidChangeNotification
                                                      object:nil
                                                    userInfo:@{@"kind" : kind ?: @"ok", @"toolTip" : toolTip ?: @""}];
}

RCT_EXPORT_METHOD(isPopoverVisible : (RCTPromiseResolveBlock)resolve reject : (RCTPromiseRejectBlock)reject)
{
  resolve(@(MMFPopoverVisible));
}

RCT_EXPORT_METHOD(closePopover)
{
  [[NSNotificationCenter defaultCenter] postNotificationName:MMFClosePopoverNotification object:nil];
}

RCT_EXPORT_METHOD(quit)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    [NSApp terminate:nil];
  });
}

@end
