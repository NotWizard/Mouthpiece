#import "ObjCExceptionCatcher.h"

NSError * _Nullable MPCatchObjCException(void (NS_NOESCAPE ^block)(void)) {
    @try {
        block();
        return nil;
    } @catch (NSException *exception) {
        NSString *reason = exception.reason ?: exception.name;
        return [NSError errorWithDomain:@"com.mouthpiece.app.objc-exception"
                                   code:1
                               userInfo:@{
                                   NSLocalizedDescriptionKey : reason,
                                   @"ExceptionName" : exception.name,
                               }];
    }
}
