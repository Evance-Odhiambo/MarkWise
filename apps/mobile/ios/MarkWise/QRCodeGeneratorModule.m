#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(QRCodeGenerator, NSObject)
RCT_EXTERN_METHOD(generateQRCode:(NSString *)content
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
@end
