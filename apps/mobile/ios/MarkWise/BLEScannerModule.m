#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface RCT_EXTERN_MODULE(BLEScanner, RCTEventEmitter)
RCT_EXTERN_METHOD(startScan:(NSString *)serviceUUID)
RCT_EXTERN_METHOD(startScanNoFilter)
RCT_EXTERN_METHOD(stopScan)
@end
