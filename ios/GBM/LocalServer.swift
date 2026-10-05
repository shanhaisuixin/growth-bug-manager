import Foundation
import Network

/* 一个只服务自己页面的迷你 HTTP 服务，绑在 127.0.0.1 的随机端口上。

   为什么要绕这一圈 —— 这是整个 iOS 壳最关键的一处取舍：

   iOS 的 WKWebView 里，本地存储（IndexedDB / localStorage）认的是「来源」。
   直接 loadFileURL 打开的话，来源是 file://，属于**不透明来源**，IndexedDB
   会被直接拒掉，而记录就存在 IndexedDB 里 —— 存档会废。

   挂一个 http://127.0.0.1:<随机端口> 就没这个问题：
   localhost 属于「安全上下文」，存储、Cache API 全都正常，
   跟安卓那边把 assets 挂到 appassets.androidplatform.net 是同一个道理。

   安全性：只监听回环网卡（requiredInterfaceType = .loopback），
   局域网和外网都连不进来；这个 App 自己也不发任何外部请求。 */

final class LocalServer {

  private let root: URL
  private let queue = DispatchQueue(label: "gbm.localserver")
  private var listener: NWListener?

  init(root: URL) {
    self.root = root
  }

  /// 起服务。端口由系统分配（避免跟别的端口撞），拿到之后由回调交出去。
  /// 这里刻意不阻塞调用方 —— 端口就绪是异步的，等到了再让 WebView 去加载。
  func start(onReady: @escaping (UInt16) -> Void, onFail: @escaping (Error) -> Void) {
    let params = NWParameters.tcp
    params.requiredInterfaceType = .loopback      // 只认回环，别的一律不听
    params.allowLocalEndpointReuse = true

    var l: NWListener
    do {
      l = try NWListener(using: params, on: .any)
    } catch {
      onFail(error)
      return
    }
    listener = l

    var settled = false
    l.stateUpdateHandler = { [weak self] state in
      switch state {
      case .ready:
        guard !settled else { return }
        settled = true
        DispatchQueue.main.async { onReady(l.port?.rawValue ?? 0) }
      case .failed(let err):
        guard !settled else { return }
        settled = true
        DispatchQueue.main.async { onFail(err) }
      default:
        break
      }
    }
    l.newConnectionHandler = { [weak self] conn in
      self?.serve(conn)
    }
    l.start(queue: queue)
  }

  func stop() {
    listener?.cancel()
    listener = nil
  }

  // MARK: - 请求处理

  private func serve(_ conn: NWConnection) {
    conn.stateUpdateHandler = { [weak self] state in
      switch state {
      case .ready:
        /* 我们只要请求头，16 KB 足够；正文不需要 */
        conn.receive(minimumIncompleteLength: 1, maximumLength: 16 * 1024) { data, _, _, err in
          guard let self = self, let data = data, err == nil else {
            conn.cancel(); return
          }
          let head = String(decoding: data, as: UTF8.self)
          let line = head.split(separator: "\r\n").first ?? ""
          let parts = line.split(separator: " ")
          guard parts.count >= 2 else { conn.cancel(); return }
          self.respond(conn, rawPath: String(parts[1]))
        }
      case .failed:
        conn.cancel()
      default:
        break
      }
    }
    conn.start(queue: queue)
  }

  private func respond(_ conn: NWConnection, rawPath: String) {
    var rel = String(rawPath.split(separator: "?", maxSplits: 1).first ?? Substring(rawPath))
    if let decoded = rel.removingPercentEncoding { rel = decoded }
    if rel.hasPrefix("/") { rel.removeFirst() }
    if rel.isEmpty { rel = "index.html" }

    /* 不许往上跳目录 —— 这是给外部 URL 用的服务，哪怕只听回环也要挡 */
    if rel.contains("..") || rel.hasPrefix("/") {
      send(conn, status: 403, type: "text/plain", body: Data("no".utf8))
      return
    }

    let file = root.appendingPathComponent(rel).standardizedFileURL
    let rootPath = root.standardizedFileURL.path
    guard file.path.hasPrefix(rootPath + "/") || file.path == rootPath,
          let body = try? Data(contentsOf: file) else {
      send(conn, status: 404, type: "text/plain", body: Data("404".utf8))
      return
    }
    send(conn, status: 200, type: mime(rel), body: body)
  }

  private func send(_ conn: NWConnection, status: Int, type: String, body: Data) {
    let reason = status == 200 ? "OK" : "Error"
    var head = "HTTP/1.1 \(status) \(reason)\r\n"
    head += "Content-Type: \(type)\r\n"
    head += "Content-Length: \(body.count)\r\n"
    /* 页面本来就在包里，HTTP 层缓存没有意义；
       壳里也不注册 Service Worker（见 RootViewController），两层都不留旧版本。 */
    head += "Cache-Control: no-store\r\n"
    head += "Connection: close\r\n\r\n"
    var out = Data(head.utf8)
    out.append(body)
    conn.send(content: out, completion: .contentProcessed { _ in conn.cancel() })
  }

  private func mime(_ path: String) -> String {
    switch (path as NSString).pathExtension.lowercased() {
    case "html", "htm": return "text/html; charset=utf-8"
    case "js": return "text/javascript; charset=utf-8"
    case "css": return "text/css; charset=utf-8"
    case "json": return "application/json; charset=utf-8"
    case "webmanifest": return "application/manifest+json"
    case "svg": return "image/svg+xml"
    case "png": return "image/png"
    case "jpg", "jpeg": return "image/jpeg"
    case "woff2": return "font/woff2"
    default: return "application/octet-stream"
    }
  }
}
