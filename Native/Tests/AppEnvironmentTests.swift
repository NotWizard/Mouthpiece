import XCTest
@testable import Mouthpiece

@MainActor
final class AppEnvironmentTests: XCTestCase {
    func testEnvironmentStartsReady() {
        XCTAssertTrue(AppEnvironment(bootstrap: false).isReady)
    }
}
