import UIKit
import WebKit
import UniformTypeIdentifiers

/* iOS 壳：一个 WKWebView，装的是打包在 App 里的网页。
   跟安卓那边（MainActivity.java）是同一套设计，区别只在平台 API 不同。

   五件事：

   1) 页面从哪儿来
      由 LocalServer 挂在 http://127.0.0.1:<随机端口> 上。
      不能用 file:// —— 那是不透明来源，IndexedDB 会被拒，存档会废。

   2) 一条权限都不申请
      记录全在本机，App 不联网、不上传、不碰相册通讯录、不定位。
      那两件「看起来要权限」的事这样解决：
        · 导出备份 → 系统文件选择器（UIDocumentPickerViewController）让用户自己挑位置
        · 检查更新 → 把发布页交给 Safari 打开
      这两条都不需要任何权限，设置里也看不到任何权限入口。

   3) 导出为什么必须走桥
      网页里那套 `<a download>` + blob 链接，在 WKWebView 里**不生效**
      （点了等于没点）。所以网页把 ZIP 的 base64 递过来（window.GBMShell），
      这边写完临时文件再交给导出选择器。

   4) 导入为什么不用桥
      `<input type="file">` 走 WKUIDelegate 的 runOpenPanelWith，
      只要这边接住、拉起选择器、把结果 URL 还回去，WebView 自己会去读。
      不接的话点下去什么都不弹 —— 这正是它在 App 里以前是坏的原因之一。

   5) 返回
      iOS 没有返回键，所以加了左边缘横滑：跟安卓的返回键一样，
      先问网页能不能自己消化（收弹窗 → 退回上一层 → 回首页）。 */

final class RootViewController: UIViewController {

  /// 跟网页 --paper 一致，冷启动那一帧不闪别的颜色
  private static let paper = UIColor(red: 0xFD / 255, green: 0xFD / 255, blue: 0xFF / 255, alpha: 1)

  private static let bridge = "gbmShell"

  private var web: WKWebView!
  private var server: LocalServer?
  private var serverPort: UInt16 = 0

  /// 导出：等用户挑完位置，临时文件才能删
  private var exportTemp: URL?
  /// 导入：`<input type="file">` 的回执
  private var panelReply: (([URL]?) -> Void)?

  // MARK: - 生命周期

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = Self.paper

    guard let root = Bundle.main.resourceURL?.appendingPathComponent("web"),
          FileManager.default.fileExists(atPath: root.path) else {
      showFatal("网页没打进 App 里，拆包检查一下 web/ 这个目录。")
      return
    }

    let cfg = WKWebViewConfiguration()
    /* 给网页打标记，跟安卓壳同一个约定：网页看到就不再注册 Service Worker。
       （参见 web/js/app.js 里的 GBMShell 判断，以及安卓 MainActivity 的说明） */
    cfg.applicationNameForUserAgent = "GBMShell/1.0"
    cfg.mediaTypesRequiringUserActionForPlayback = .all
    cfg.userContentController.add(self, name: Self.bridge)

    let wv = WKWebView(frame: view.bounds, configuration: cfg)
    wv.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    wv.navigationDelegate = self
    wv.uiDelegate = self
    wv.isOpaque = false
    wv.backgroundColor = Self.paper
    wv.scrollView.backgroundColor = Self.paper
    wv.scrollView.showsVerticalScrollIndicator = false
    wv.scrollView.showsHorizontalScrollIndicator = false
    /* 安全区交给网页自己的 env(safe-area-inset-*) 处理（CSS 里已经做了），
       这里再 inset 一次会变成双倍留白。 */
    wv.scrollView.contentInsetAdjustmentBehavior = .never
    view.addSubview(wv)
    web = wv

    excludeRecordsFromBackup()
    addEdgeBackGesture()

    let srv = LocalServer(root: root)
    server = srv
    srv.start { [weak self] port in
      guard let self = self else { return }
      self.serverPort = port
      let url = URL(string: "http://127.0.0.1:\(port)/index.html")!
      self.web.load(URLRequest(url: url))
    } onFail: { [weak self] err in
      self?.showFatal("本地页面起不来：\(err.localizedDescription)")
    }
  }

  override var preferredStatusBarStyle: UIStatusBarStyle { .darkContent }

  override func viewDidDisappear(_ animated: Bool) {
    super.viewDidDisappear(animated)
    /* 页面已经不在了，把悬着的回执收掉，免得网页一直等 */
    if let reply = panelReply { panelReply = nil; reply(nil) }
  }

  deinit {
    server?.stop()
  }

  // MARK: - 记录别跟着云备份跑出去

  /* 跟安卓那边的 allowBackup="false" 是一回事：
     App 容器默认是会被 iCloud/iTunes 备份的，记录就在里面。
     把 WebKit 的数据目录标记为「不参与备份」，记录就只留在这台手机上。 */
  private func excludeRecordsFromBackup() {
    let fm = FileManager.default
    guard let lib = fm.urls(for: .libraryDirectory, in: .userDomainMask).first else { return }
    let dir = lib.appendingPathComponent("WebKit")
    try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
    var url = dir
    var values = URLResourceValues()
    values.isExcludedFromBackup = true
    try? url.setResourceValues(values)
  }

  // MARK: - 左边缘横滑当返回键

  private func addEdgeBackGesture() {
    let g = UIScreenEdgePanGestureRecognizer(target: self, action: #selector(onEdgePan(_:)))
    g.edges = .left
    g.delegate = self
    view.addGestureRecognizer(g)
  }

  @objc private func onEdgePan(_ g: UIScreenEdgePanGestureRecognizer) {
    let t = g.translation(in: view)
    /* 只有「明显横向往右滑、几乎没上下位移」才算返回，
       免得跟页面里的竖向滚动打架。 */
    guard g.state == .ended, t.x > 70, abs(t.y) < 40 else { return }
    web.evaluateJavaScript("(window.GBM_BACK && window.GBM_BACK()) === true") { _, _ in }
  }

  // MARK: - 导出

  private func saveZip(b64: String, name: String) {
    DispatchQueue.global(qos: .userInitiated).async { [weak self] in
      guard let self = self else { return }

      guard let data = Data(base64Encoded: b64, options: .ignoreUnknownCharacters) else {
        return DispatchQueue.main.async { self.tellExport("fail:备份内容读不出来") }
      }
      let safe = name.replacingOccurrences(of: "/", with: "_")
      let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(safe)
      do {
        try data.write(to: tmp, options: .atomic)
      } catch {
        return DispatchQueue.main.async { self.tellExport("fail:" + error.localizedDescription) }
      }

      DispatchQueue.main.async {
        self.exportTemp = tmp
        let picker = UIDocumentPickerViewController(forExporting: [tmp])
        picker.delegate = self
        self.present(picker, animated: true)
      }
    }
  }

  private func tellExport(_ result: String) {
    web.evaluateJavaScript("window.GBM_EXPORT_DONE&&window.GBM_EXPORT_DONE(\(jsQuote(result)))",
                           completionHandler: nil)
  }

  private func cleanupTemp() {
    guard let u = exportTemp else { return }
    exportTemp = nil
    try? FileManager.default.removeItem(at: u)
  }

  private func jsQuote(_ s: String) -> String {
    let e = s.replacingOccurrences(of: "\\", with: "\\\\")
      .replacingOccurrences(of: "'", with: "\\'")
      .replacingOccurrences(of: "\n", with: "\\n")
      .replacingOccurrences(of: "\r", with: "\\r")
    return "'" + e + "'"
  }

  // MARK: - 打不开的时候给句人话

  private func showFatal(_ text: String) {
    web?.removeFromSuperview()
    let l = UILabel()
    l.text = text
    l.numberOfLines = 0
    l.textAlignment = .center
    l.textColor = .secondaryLabel
    l.font = .systemFont(ofSize: 15)
    l.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(l)
    NSLayoutConstraint.activate([
      l.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
      l.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32),
      l.centerYAnchor.constraint(equalTo: view.centerYAnchor)
    ])
  }
}

// MARK: - 网页 → 原生

extension RootViewController: WKScriptMessageHandler {
  func userContentController(_ controller: WKUserContentController,
                             didReceive message: WKScriptMessage) {
    guard message.name == Self.bridge,
          let body = message.body as? [String: Any],
          let op = body["op"] as? String else { return }
    switch op {
    case "saveZip":
      saveZip(b64: body["b64"] as? String ?? "",
              name: body["name"] as? String ?? "成长Bug备份.zip")
    default:
      break
    }
  }
}

// MARK: - 导航

extension RootViewController: WKNavigationDelegate {

  /// 自己的页面照常加载；外面的链接交给 Safari。
  /// 只放行 http/https，其余（tel:、mailto:、intent:、自定义协议）一律不理。
  func webView(_ webView: WKWebView,
               decidePolicyFor navigationAction: WKNavigationAction,
               decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
    guard let u = navigationAction.request.url else { return decisionHandler(.cancel) }
    if isOurs(u) { return decisionHandler(.allow) }
    if isWebURL(u) {
      openOutside(u)
      return decisionHandler(.cancel)
    }
    decisionHandler(.cancel)
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    /* 加载失败多半是本地服务还没热起来，给一句能看懂的话比白屏强 */
    if (error as NSError).code == NSURLErrorCancelled { return }
    showFatal("页面加载失败：\(error.localizedDescription)")
  }

  private func isOurs(_ u: URL) -> Bool {
    return u.host == "127.0.0.1" && Int(u.port ?? 0) == Int(serverPort)
  }

  private func isWebURL(_ u: URL) -> Bool {
    guard let s = u.scheme?.lowercased() else { return false }
    return s == "http" || s == "https"
  }

  private func openOutside(_ u: URL) {
    guard isWebURL(u) else { return }
    UIApplication.shared.open(u, options: [:], completionHandler: nil)
  }
}

// MARK: - 新窗口 / 文件选择器

extension RootViewController: WKUIDelegate {

  /* 网页里点外链用的是 window.open('_blank')（「去发布页看看」就是），
     不接住的话 WKWebView 会什么都不做。返回 nil 表示「不开新窗口」，
     同时顺手把链接交给 Safari。 */
  func webView(_ webView: WKWebView,
               createWebViewWith configuration: WKWebViewConfiguration,
               for navigationAction: WKNavigationAction,
               windowFeatures: WKWindowFeatures) -> WKWebView? {
    if let u = navigationAction.request.url { openOutside(u) }
    return nil
  }

  /* 导入备份：网页那边的 <input type="file"> 会走到这里。
     asCopy: true —— 先复制到 App 自己的临时目录，这样 WebView 才读得到。 */
  func webView(_ webView: WKWebView,
               runOpenPanelWith parameters: WKOpenPanelParameters,
               initiatedByFrame frame: WKFrameInfo,
               completionHandler: @escaping ([URL]?) -> Void) {
    panelReply = completionHandler
    let types: [UTType] = [.zip, .json, .data]
    let picker = UIDocumentPickerViewController(forOpeningContentTypes: types, asCopy: true)
    picker.allowsMultipleSelection = parameters.allowsMultipleSelection
    picker.delegate = self
    present(picker, animated: true)
  }
}

// MARK: - 文件选择器的结果

extension RootViewController: UIDocumentPickerDelegate {

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    if let reply = panelReply {
      panelReply = nil
      reply(urls)
      return
    }
    guard exportTemp != nil else { return }
    tellExport("ok")
    cleanupTemp()
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    if let reply = panelReply {
      panelReply = nil
      reply(nil)
      return
    }
    guard exportTemp != nil else { return }
    tellExport("cancel")
    cleanupTemp()
  }
}

// MARK: - 手势

extension RootViewController: UIGestureRecognizerDelegate {
  /* 让边缘手势跟页面的滚动并存 —— 不并存的话竖着滚会先被手势吃掉一截 */
  func gestureRecognizer(_ g: UIGestureRecognizer,
                         shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool {
    return true
  }
}
