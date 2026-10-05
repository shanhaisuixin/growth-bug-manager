package com.fengxiao.gbm;

/* 整个安卓端就这一个文件：一个 WebView，装的是打包在 APK 里的网页。

   五件事值得单独说：

   1) 为什么不用 file:// 直接开网页
      file:// 在 WebView 里算「不透明来源」，IndexedDB 会被直接拒掉，
      而记录就存在 IndexedDB 里 —— 存档会废。所以用 WebViewAssetLoader
      把 assets 挂成一个虚拟的 https 域名，来源就是「安全」的了。

   2) 为什么把 User-Agent 打上标记
      网页那边本来会注册 Service Worker 做离线缓存。装在 App 里时这层是多余的：
      文件本来就在 APK 里，而且 SW 的缓存会跨版本留着，出现「装了新版却看到旧页面」。
      所以壳里给 UA 加个 GBMShell 标记，网页看到就不再注册 SW。

   3) 返回键
      先问网页能不能自己消化（收掉弹窗 → 退回上一层 → 回首页），
      网页说不行了才交回系统退出。

   4) 为什么这个 App 一条权限都不要
      记录全在本机，App 不联网、不上传。那两件「看起来必须要联网」的事这么解决：
        · 导出备份 → 系统的「保存到哪儿」选择器（SAF，ACTION_CREATE_DOCUMENT），
          位置由用户自己挑，写文件用的是用户当场给出的授权，不需要任何权限。
        · 检查更新 → 把发布页交给系统浏览器打开，联网的是浏览器，不是 App。
      注意：`<a download>` 那套在 WebView 里是**不生效**的（blob: 链接不会触发下载），
      所以导出必须走下面的 saveZip 桥，不能指望网页那句 a.click()。

   5) 导入为什么也不用权限
      `<input type="file">` 在 WebView 里默认什么都不弹，必须由 onShowFileChooser
      接住、去拉起系统文件选择器，再把结果 URI 还回去。WebView 拿到 URI 之后
      是自己去读的（用的是那次选择附带的临时授权），跟 App 有没有存储权限无关。 */

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Message;
import android.util.Base64;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.webkit.WebViewAssetLoader;

import java.io.ByteArrayInputStream;
import java.io.OutputStream;

public class MainActivity extends AppCompatActivity {

  /** 页面入口。对应仓库里的 web/index.html，构建时被拷进 assets。 */
  private static final String HOME =
      "https://appassets.androidplatform.net/assets/index.html";

  /** 跟网页的 --paper 一致，冷启动那一瞬间不会闪别的颜色 */
  private static final int PAPER = 0xFFFDFDFF;

  /** base64 传过来的字符串超过这个长度就不要了。
      正常备份是几百 KB 级别，真撞到这个数说明出了别的问题，
      与其在桥上卡死，不如给一句人话的错误。 */
  private static final int MAX_B64 = 48 * 1024 * 1024;

  private WebView web;

  /* ---------- 导入（就是个 <input type="file"> 的回执） ---------- */
  private ValueCallback<Uri[]> fileCb;
  private ActivityResultLauncher<Intent> importLauncher;

  /* ---------- 导出（等用户挑完存哪儿，再把字节写进去） ---------- */
  private ActivityResultLauncher<Intent> exportLauncher;
  private String pendingB64;

  @SuppressLint("SetJavaScriptEnabled")
  @Override
  protected void onCreate(Bundle state) {
    super.onCreate(state);

    /* 两个选择器都必须在 onCreate 里登记好（框架的要求：要早于 Activity 进入 STARTED）。 */

    importLauncher = registerForActivityResult(
        new ActivityResultContracts.StartActivityForResult(),
        result -> {
          if (fileCb == null) return;
          Uri[] uris = null;
          if (result.getResultCode() == Activity.RESULT_OK && result.getData() != null) {
            /* 让框架按 accept 属性把结果解成 URI 数组 */
            uris = WebChromeClient.FileChooserParams.parseResult(
                result.getResultCode(), result.getData());
          }
          /* 传 null 回去表示「用户取消了」，WebView 自己会把 change 事件收掉 */
          fileCb.onReceiveValue(uris);
          fileCb = null;
        });

    exportLauncher = registerForActivityResult(
        new ActivityResultContracts.StartActivityForResult(),
        result -> {
          final String b64 = pendingB64;
          pendingB64 = null;

          if (b64 == null) return;
          if (result.getResultCode() != Activity.RESULT_OK
              || result.getData() == null
              || result.getData().getData() == null) {
            tell("cancel");
            return;
          }
          final Uri target = result.getData().getData();

          /* 几十 KB 到几 MB 的解码 + 落盘，放到后台线程去做，
             别在主线程里把界面卡住。 */
          new Thread(() -> {
            String outcome;
            try {
              byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
              try (OutputStream os = getContentResolver().openOutputStream(target, "wt")) {
                if (os == null) throw new IllegalStateException("openOutputStream 返回空");
                os.write(bytes);
                os.flush();
              }
              outcome = "ok";
            } catch (Throwable t) {
              outcome = "fail:" + shortMsg(t);
            }
            final String o = outcome;
            runOnUiThread(() -> tell(o));
          }, "gbm-export").start();
        });

    final WebViewAssetLoader loader = new WebViewAssetLoader.Builder()
        .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
        .build();

    web = new WebView(this);
    web.setBackgroundColor(PAPER);

    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);          // localStorage 兜底要用
    s.setDatabaseEnabled(true);
    s.setAllowFileAccess(false);           // 不给 file:// 开口子
    /* content:// 得留着：导入要走的系统文件选择器，回来的就是 content:// URI。
       安全不靠这条开关，靠下面 shouldOverrideUrlLoading / shouldInterceptRequest
       里的白名单 —— 页面只能加载自己那一个域名。 */
    s.setAllowContentAccess(true);
    s.setSupportZoom(false);
    s.setBuiltInZoomControls(false);
    s.setTextZoom(100);                    // 版式是按固定字号调的，别被系统字号撑坏
    s.setMediaPlaybackRequiresUserGesture(true);
    s.setSupportMultipleWindows(true);     // 「去看看」外链走的是 window.open
    s.setJavaScriptCanOpenWindowsAutomatically(true);
    s.setCacheMode(WebSettings.LOAD_DEFAULT);
    /* 给壳打标记，让网页知道自己被装进 App 里了（见上面第 2 点） */
    s.setUserAgentString(s.getUserAgentString() + " GBMShell/1.0");

    /* 滚到顶/底那一下的蓝色光晕，在「一张纸」的观感里很出戏，关掉。
       滚动条同样不显示 —— 手机上本来就都是手势滚。 */
    web.setOverScrollMode(View.OVER_SCROLL_NEVER);
    web.setVerticalScrollBarEnabled(false);
    web.setHorizontalScrollBarEnabled(false);

    /* 导出用的桥。对象只在自家这个安全来源下可见，外站拿不到。 */
    web.addJavascriptInterface(new Shell(), "GBMShell");

    web.setWebViewClient(new WebViewClient() {
      @Override
      public WebResourceResponse shouldInterceptRequest(WebView v, WebResourceRequest req) {
        Uri u = req.getUrl();
        if (isOwnPage(u)) return loader.shouldInterceptRequest(u);
        String scheme = u == null ? null : u.getScheme();
        /* http/https 指向外面的，一律掐掉（这个 App 本来就不该有任何外部请求）。
           其余 scheme（blob:、data:、about: 这些网页自己的东西）返回 null，
           意思是「不拦，照常走」。 */
        if ("http".equals(scheme) || "https".equals(scheme)) return blocked();
        return null;
      }

      /** 自己的页面照常加载；外面的链接一律交给系统浏览器 */
      @Override
      public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
        Uri u = req.getUrl();
        if (isOwnPage(u)) return false;
        handOff(u);
        return true;
      }
    });

    /* 网页里点外链用的是 window.open('_blank')，不接住的话
       WebView 会默默什么都不做（或者在里面打开、然后回不来）。 */
    web.setWebChromeClient(new WebChromeClient() {

      @Override
      public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb,
                                       FileChooserParams params) {
        /* 上一次还没回执就又点了一次：先把旧的收掉，不然那个回调永远悬着 */
        if (fileCb != null) {
          fileCb.onReceiveValue(null);
          fileCb = null;
        }
        fileCb = cb;
        try {
          Intent intent = params.createIntent();
          intent.addCategory(Intent.CATEGORY_OPENABLE);
          importLauncher.launch(intent);
          return true;
        } catch (Exception e) {
          /* 手机上没有文件管理器之类的情况：把回调收了，网页会看到「没选文件」 */
          fileCb = null;
          return false;
        }
      }

      @Override
      public boolean onCreateWindow(WebView view, boolean isDialog,
                                    boolean isUserGesture, Message resultMsg) {
        WebView.HitTestResult hit = view.getHitTestResult();
        if (hit != null && hit.getType() == WebView.HitTestResult.SRC_ANCHOR_TYPE
            && hit.getExtra() != null
            && !isOwnPage(Uri.parse(hit.getExtra()))) {
          handOff(Uri.parse(hit.getExtra()));
          return true;
        }
        /* 拿不到链接就塞一个一次性 WebView 接住这次跳转 */
        WebView tmp = new WebView(MainActivity.this);
        tmp.setWebViewClient(new WebViewClient() {
          @Override
          public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest req) {
            handOff(req.getUrl());
            return true;
          }
        });
        if (resultMsg != null && resultMsg.obj instanceof WebView.WebViewTransport) {
          ((WebView.WebViewTransport) resultMsg.obj).setWebView(tmp);
          resultMsg.sendToTarget();
          return true;
        }
        return false;
      }
    });

    FrameLayout root = new FrameLayout(this);
    root.addView(web, new FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    setContentView(root);

    web.loadUrl(HOME);

    MainActivity.this.getOnBackPressedDispatcher().addCallback(this,
        new OnBackPressedCallback(true) {
          @Override
          public void handleOnBackPressed() {
            final WebView w = web;
            if (w == null) {
              /* Activity 已经在销毁了，别去碰 WebView，直接交回系统 */
              setEnabled(false);
              MainActivity.this.getOnBackPressedDispatcher().onBackPressed();
              return;
            }
            w.evaluateJavascript("(window.GBM_BACK && window.GBM_BACK()) === true",
                value -> {
                  if (!"true".equals(value)) {
                    setEnabled(false);
                    MainActivity.this.getOnBackPressedDispatcher().onBackPressed();
                  }
                });
          }
        });
  }

  /* ================= 网页能调到的接口 ================= */

  private final class Shell {

    /** 网页用它判断「我是不是装在 App 里」。 */
    @JavascriptInterface
    public String platform() {
      return "android";
    }

    /**
     * 导出备份。
     *
     * @param b64  整个 ZIP 的 base64（网页那边用 btoa 拼的）
     * @param name 建议的文件名，用户在选择器里还能改
     */
    @JavascriptInterface
    public void saveZip(final String b64, final String name) {
      /* JS 桥的方法跑在后台线程，弹选择器必须回主线程 */
      runOnUiThread(() -> startExport(b64, name));
    }
  }

  private void startExport(String b64, String name) {
    if (b64 == null || b64.isEmpty()) {
      tell("fail:没有内容");
      return;
    }
    if (b64.length() > MAX_B64) {
      tell("fail:备份太大，请改用网页版导出");
      return;
    }

    pendingB64 = b64;

    Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
    i.addCategory(Intent.CATEGORY_OPENABLE);
    i.setType("application/zip");
    i.putExtra(Intent.EXTRA_TITLE,
        (name == null || name.isEmpty()) ? "成长Bug备份.zip" : name);
    try {
      exportLauncher.launch(i);
    } catch (Exception e) {
      pendingB64 = null;
      tell("fail:" + shortMsg(e));
    }
  }

  /** 告诉网页导出完了没有。网页那边挂的是 window.GBM_EXPORT_DONE。 */
  private void tell(String outcome) {
    if (web == null) return;
    String js = "window.GBM_EXPORT_DONE&&window.GBM_EXPORT_DONE(" + quote(outcome) + ")";
    web.evaluateJavascript(js, null);
  }

  /* ================= 小工具 ================= */

  private static String quote(String s) {
    if (s == null) return "''";
    StringBuilder b = new StringBuilder(s.length() + 8);
    b.append('\'');
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      if (c == '\'' || c == '\\') b.append('\\').append(c);
      else if (c == '\n') b.append("\\n");
      else if (c == '\r') b.append("\\r");
      else if (c < 0x20) b.append(' ');
      else b.append(c);
    }
    b.append('\'');
    return b.toString();
  }

  private static String shortMsg(Throwable t) {
    String m = t.getMessage();
    if (m == null || m.isEmpty()) m = t.getClass().getSimpleName();
    if (m.length() > 120) m = m.substring(0, 120);
    return m;
  }

  /** 空响应体。返回 null 的 InputStream 在有些系统版本上会炸，给个零长度的流最稳。 */
  private static WebResourceResponse blocked() {
    return new WebResourceResponse("text/plain", "utf-8",
        new ByteArrayInputStream(new byte[0]));
  }

  private static boolean isOwnPage(Uri u) {
    return u != null && "appassets.androidplatform.net".equals(u.getHost());
  }

  /** 交给系统浏览器打开。只放行 http/https，其余（data:、intent:、content: 等）一律拦掉。 */
  private void handOff(Uri u) {
    if (u == null) return;
    String scheme = u.getScheme();
    if (scheme == null) return;
    if (!"http".equals(scheme) && !"https".equals(scheme)) return;
    try {
      startActivity(new Intent(Intent.ACTION_VIEW, u));
    } catch (Exception ignored) {
      /* 手机上没装浏览器也无所谓，别把 App 带崩 */
    }
  }

  @Override
  protected void onDestroy() {
    if (fileCb != null) {
      /* Activity 要没了，把悬着的回调收掉，免得 WebView 那边一直等 */
      fileCb.onReceiveValue(null);
      fileCb = null;
    }
    if (web != null) {
      web.destroy();
      web = null;
    }
    super.onDestroy();
  }
}
