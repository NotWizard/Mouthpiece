#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Runs the block, catching any Objective-C NSException (which Swift
/// do/catch cannot intercept) and returning it as an NSError.
NSError * _Nullable MPCatchObjCException(void (NS_NOESCAPE ^block)(void));

NS_ASSUME_NONNULL_END
