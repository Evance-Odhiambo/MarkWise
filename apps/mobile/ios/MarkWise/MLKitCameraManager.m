#import <React/RCTViewManager.h>

@interface RCT_EXTERN_MODULE(MLKitCameraViewManager, RCTViewManager)
RCT_EXPORT_VIEW_PROPERTY(onBarcodeScan, RCTDirectEventBlock)
RCT_EXPORT_VIEW_PROPERTY(onCameraReady, RCTDirectEventBlock)
@end
