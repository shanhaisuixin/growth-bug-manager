# -*- coding: utf-8 -*-
"""逐个下载依赖库的 AAR，看它的清单里有没有 uses-permission。

背景：我们声称 App「一条权限都不申请」，但解 APK 时发现合并后的清单里
居然出现了一条 <uses-permission android:name="android.permission.DUMP"/>。
源清单是我手写的、里面一条都没有，所以只剩两种可能：
  1. 某个依赖库自己声明了（库里带 uses-permission 很常见）；
  2. AGP / AndroidX 的构建期逻辑自动注入的。
这个脚本用来把第 1 种情况查清楚。
"""
import io
import re
import sys
import urllib.request

BASE = 'https://dl.google.com/dl/android/maven2/'
TARGETS = [
    ('androidx/webkit', 'webkit', '1.11.0'),
    ('androidx/appcompat', 'appcompat', '1.7.0'),
    ('androidx/activity', 'activity', '1.9.2'),
    ('androidx/core', 'core', '1.13.1'),
    ('androidx/profileinstaller', 'profileinstaller', '1.4.1'),
    ('androidx/profileinstaller', 'profileinstaller', '1.3.1'),
    ('androidx/emoji2', 'emoji2', '1.4.0'),
    ('androidx/emoji2', 'emoji2', '1.3.0'),
    ('androidx/fragment', 'fragment', '1.8.5'),
    ('androidx/startup', 'startup-runtime', '1.1.1'),
    ('androidx/lifecycle', 'lifecycle-runtime', '2.8.7'),
    ('androidx/savedstate', 'savedstate', '1.2.1'),
    ('androidx/annotation', 'annotation', '1.8.0'),
    ('androidx/collection', 'collection', '1.4.2'),
    ('androidx/versionparcelable', 'versionparcelable', '1.1.1'),
    ('androidx/tracing', 'tracing', '1.4.0'),
]

TAG = re.compile(r'<uses-permission[^>]*?>')


def fetch(group, art, ver):
    url = '%s%s/%s/%s/%s-%s.aar' % (BASE, group, art, ver, art, ver)
    req = urllib.request.Request(url, headers={'User-Agent': 'curl/8'})
    with urllib.request.urlopen(req, timeout=40) as r:
        return r.read()


def main():
    for group, art, ver in TARGETS:
        url = '%s%s/%s/%s/%s-%s.aar' % (BASE, group, art, ver, art, ver)
        try:
            data = fetch(group, art, ver)
        except Exception as e:
            print('  %-46s 取不到（%s）' % (art + ':' + ver, type(e).__name__))
            continue
        txt = None
        try:
            import zipfile
            zf = zipfile.ZipFile(io.BytesIO(data))
            txt = zf.read('AndroidManifest.xml').decode('utf-8', 'replace')
        except Exception:
            pass
        if not txt:
            print('  %-46s 没有可读清单' % (art + ':' + ver))
            continue
        hits = TAG.findall(txt)
        if hits:
            print('  ★★★ 命中 %s:%s' % (art, ver))
            for h in hits:
                print('        ' + h)
        else:
            print('  %-46s 无 uses-permission' % (art + ':' + ver))
    return 0


if __name__ == '__main__':
    sys.exit(main())
