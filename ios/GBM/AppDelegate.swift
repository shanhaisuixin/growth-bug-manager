import UIKit

/* 入口。整个 App 就一个窗口、一个 WKWebView（RootViewController）。

   没用 SceneDelegate / SwiftUI：这个壳不需要多窗口、不需要生命周期回调，
   一个 AppDelegate 加一个 window 就够了，少一层就少一处出错的地方。
   Info.plist 里也别加任何 NS*UsageDescription —— 一条权限都不申请。 */

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {

  var window: UIWindow?

  func application(_ application: UIApplication,
                   didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    let w = UIWindow(frame: UIScreen.main.bounds)
    w.backgroundColor = UIColor(red: 0xFD / 255, green: 0xFD / 255, blue: 0xFF / 255, alpha: 1)
    w.rootViewController = RootViewController()
    w.makeKeyAndVisible()
    window = w
    return true
  }
}
