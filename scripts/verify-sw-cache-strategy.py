#!/usr/bin/env python3
"""Service Worker のキャッシュ戦略を実ブラウザで検証する。

Issue #5 の受け入れ条件は「既に SW を導入済み**だった**クライアントが再訪問すると
新コードが届く」ことなので、静的なレビューでは証明できない。次の 2 訪問を
Playwright + 同梱 Chromium で実際に再現する。

  訪問 1 (sw-before): 古い Service Worker をインストールさせる
  訪問 2 (sw-after) : 別の Service Worker 服务业態で再訪問する
                      （間には game.js だけ BUILD-1 -> BUILD-2 へ差し替える）

同じ user_data_dir を使い回すことで、Cache Storage と Service Worker 登録が
訪問をまたいで永続する = 「既に SW を導入済みだったクライアント」を再現している。

使い方:
    python3 scripts/verify-sw-cache-strategy.py --expect-stale
    python3 scripts/verify-sw-cache-strategy.py --expect-fresh
    python3 scripts/verify-sw-cache-strategy.py --expect-fresh \
        --sw-before /tmp/sw-before.js --sw-after ./sw.js
"""

from __future__ import annotations

import argparse
import functools
import http.server
import json
import os
import shutil
import socketserver
import sys
import tempfile
import threading
import time
from pathlib import Path

MARKER_TEMPLATE = "window.__BUILD__ = '{build}';\n"
BUILD_1 = "BUILD-1"
BUILD_2 = "BUILD-2"

# 訪問ごとに 「document が load 済み」 まで待つためのスクリプト。
READY_EXPR = "() => document.readyState === 'complete'"

# SW の install/activate 完了を待つ。reg.update() は更新チェックの完了を返すので、
# その時点で reg.installing を見れば新しい SW を捕まえられる。
UPDATE_JS = """
async (timeoutMs) => {
  const reg = await navigator.serviceWorker.ready;
  const before = reg.active ? reg.active.state : null;
  await reg.update();
  const sw = reg.installing || reg.waiting || null;
  if (!sw) return { updated: false, before, after: reg.active ? reg.active.state : null };
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('sw statechange timeout')), timeoutMs);
    const done = () => {
      if (sw.state === 'activated' || sw.state === 'redundant') { clearTimeout(timer); resolve(); }
    };
    sw.addEventListener('statechange', done);
    done();
  });
  return { updated: true, before, after: sw.state, scriptURL: sw.scriptURL };
}
"""

READ_STATE_JS = """
async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  const names = await caches.keys();
  const entries = {};
  for (const name of names) {
    const cache = await caches.open(name);
    entries[name] = (await cache.keys()).map(r => new URL(r.url).pathname + (new URL(r.url).host ? ' @' + new URL(r.url).host : '')).sort();
  }
  return {
    controller: navigator.serviceWorker.controller ? navigator.serviceWorker.controller.scriptURL : null,
    active: reg && reg.active ? reg.active.scriptURL : null,
    cacheNames: names.sort(),
    cacheEntries: entries,
    build: typeof window.__BUILD__ === 'string' ? window.__BUILD__ : null,
    hasCanvas: !!document.querySelector('#game canvas'),
    canvasSize: (() => { const c = document.querySelector('#game canvas'); return c ? [c.width, c.height] : null; })(),
    hasP5: typeof window.p5 !== 'undefined',
    hasDeepSeaStart: typeof window.deepSeaStart === 'function'
  };
}
"""


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):  # noqa: D102 - http.server の黙示を握る
        pass

    def do_GET(self):
        # --test-timeout 用。同一オリジンの応答を故意に返させなくする。
        if HANG["on"]:
            time.sleep(HANG["seconds"])
        return super().do_GET()


HANG = {"on": False, "seconds": 60}


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def serve(directory: Path):
    handler = functools.partial(QuietHandler, directory=str(directory))
    httpd = Server(("127.0.0.1", 0), handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}/"


def deploy_build(site: Path, build: str):
    """擬似デプロイ。game.js だけを書き換える（sw.js は触らない）。"""
    game = site / "game.js"
    original = game.read_text(encoding="utf-8")
    lines = original.splitlines(keepends=True)
    for line in lines:
        if line.startswith("window.__BUILD__"):
            lines.remove(line)
            break
    game.write_text(MARKER_TEMPLATE.format(build=build) + "".join(lines), encoding="utf-8")


class Visits:
    """2 回の訪問を、同一プロファイル（= 同一クライアント）として実行する。"""

    def __init__(self, playwright, profile: Path):
        self.pw = playwright
        self.profile = profile
        self.ctx = None

    def open(self, site: Path, sw_source: Path | None):
        if sw_source is not None:
            shutil.copyfile(sw_source, site / "sw.js")
        httpd, base = serve(site)
        ctx = self.pw.chromium.launch_persistent_context(
            user_data_dir=str(self.profile),
            headless=True,
            args=["--no-sandbox", "--disable-dev-shm-usage"],
            service_workers="allow",
        )
        self.httpd, self.base, self.ctx = httpd, base, ctx
        self.site = site
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        self.page = page
        return page

    def close(self):
        if self.ctx is not None:
            self.ctx.close()
        if self.httpd is not None:
            self.httpd.shutdown()


def first_visit(visits: Visits, site: Path, sw_source: Path | None, build: str, log):
    deploy_build(site, build)
    page = visits.open(site, sw_source)
    page.goto(visits.base, wait_until="load")
    page.wait_for_function("() => navigator.serviceWorker.ready.then(() => true)", timeout=20000)
    state = page.evaluate(READ_STATE_JS)
    log(f"[visit 1] sw={os.path.basename(sw_source) if sw_source else '(repo)'} build={state['build']} caches={state['cacheNames']}")
    return state


def second_visit(visits: Visits, sw_source: Path, build: str, log):
    """擬似デプロイ後の再訪問。SW の更新 -> install/activate -> 再リロード。"""
    shutil.copyfile(sw_source, visits.site / "sw.js")
    page = visits.page
    page.reload(wait_until="load")
    page.wait_for_function("() => navigator.serviceWorker.ready.then(() => true)", timeout=20000)
    update = page.evaluate(UPDATE_JS, 20000)
    log(f"[visit 2] sw update: {update}")
    page.reload(wait_until="load")
    page.wait_for_function(READY_EXPR, timeout=20000)
    page.wait_for_function("() => typeof window.__BUILD__ === 'string'", timeout=10000)
    online = page.evaluate(READ_STATE_JS)
    log(f"[visit 2] online build={online['build']} caches={online['cacheNames']}")

    visits.ctx.set_offline(True)
    page.reload(wait_until="load")
    page.wait_for_function(READY_EXPR, timeout=20000)
    page.wait_for_function("() => document.querySelector('#game canvas')", timeout=20000)
    offline = page.evaluate(READ_STATE_JS)
    log(f"[visit 2] offline build={offline['build']} canvas={offline['hasCanvas']} p5={offline['hasP5']} start={offline['hasDeepSeaStart']}")
    return update, online, offline


def hang_visit(visits: Visits, log):
    """サーバーが応答しない状態で再訪問し、タイムアウトガードを測る。

    オフライン（fetch が即エラー）とは別に、回線は生きているが応答が無い状態を再現する。
    """
    visits.ctx.set_offline(False)
    HANG["on"] = True
    started = time.monotonic()
    try:
        visits.page.reload(wait_until="load")
        visits.page.wait_for_function(READY_EXPR, timeout=30000)
        visits.page.wait_for_function("() => document.querySelector('#game canvas')", timeout=30000)
        elapsed = time.monotonic() - started
        state = visits.page.evaluate(READ_STATE_JS)
    finally:
        HANG["on"] = False
    state["reloadSeconds"] = round(elapsed, 2)
    log(f"[visit 2] hung network: {elapsed:.2f}s で描画（ビルド {state['build']} / canvas {state['hasCanvas']}）")
    return state


def evaluate(offline, online, hung, expect_fresh: bool):
    checks = []

    def check(name, ok, detail):
        checks.append({"name": name, "ok": bool(ok), "detail": detail})

    fresh = offline["build"] == BUILD_2
    check(
        "再訪問で game.js の更新が届く",
        fresh if expect_fresh else not fresh,
        f"build={offline['build']!r} (期待: {'BUILD-2' if expect_fresh else 'BUILD-1 に取り残される（再現）'})",
    )
    check("オフラインで canvas が描画される", offline["hasCanvas"], f"canvas={offline['hasCanvas']} size={offline['canvasSize']}")
    check("オフラインで window.deepSeaStart が存在する", offline["hasDeepSeaStart"], f"{offline['hasDeepSeaStart']}")
    check("p5.js は CDN からキャッシュ経由で供給される", offline["hasP5"], f"window.p5={offline['hasP5']}")
    if expect_fresh:
        check(
            "応答しないサーバーでもタイムアウト後に描画できる",
            hung["hasCanvas"] and hung["hasDeepSeaStart"] and hung["reloadSeconds"] < 25,
            f"{hung['reloadSeconds']}s / canvas={hung['hasCanvas']} start={hung['hasDeepSeaStart']} build={hung['build']!r}",
        )

    names = offline["cacheNames"]
    expected_cache = "deep-sea-hunter-v2" if expect_fresh else "deep-sea-hunter-v1"
    if expect_fresh:
        check("キャッシュ世代が v1 -> v2 に上がり、旧世代は削除されている", names == ["deep-sea-hunter-v2"], f"caches.keys()={names}")
        entries = offline["cacheEntries"].get("deep-sea-hunter-v2", [])
        p5_in_cache = any("p5" in e for e in entries)
        check("p5.js が v2 キャッシュに入っている", p5_in_cache, f"entries={entries}")
        check("アプリシェル 6 件が v2 キャッシュに入っている", sum(1 for e in entries if "p5" not in e) >= 6, f"entries={entries}")
    else:
        check("（再現）キャッシュは v1 のまま", names == ["deep-sea-hunter-v1"], f"caches.keys()={names}")

    check("Service Worker が controller になっている", offline["controller"] is not None, f"controller={offline['controller']}")
    return checks


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repo", default=str(Path(__file__).resolve().parent.parent), help="検証対象のソースツリー")
    parser.add_argument("--sw-before", default=None, help="訪問1で使う sw.js（省略時は repo のもの）")
    parser.add_argument("--sw-after", default=None, help="訪問2で使う sw.js（省略時は repo のもの）")
    parser.add_argument("--expect-fresh", action="store_true", help="BUILD-2 が届くことを期待する（修正後）")
    parser.add_argument("--expect-stale", action="store_true", help="BUILD-1 に取り残されることを期待する（修正前の再現）")
    parser.add_argument("--json", default=None, help="観測結果を JSON で書き出す")
    parser.add_argument("--keep-temp", action="store_true")
    args = parser.parse_args()
    if args.expect_fresh == args.expect_stale:
        parser.error("--expect-fresh と --expect-stale のどちらか一方を指定してください")

    from playwright.sync_api import sync_playwright

    repo = Path(args.repo).resolve()
    sw_after = Path(args.sw_after).resolve() if args.sw_after else repo / "sw.js"
    sw_before = Path(args.sw_before).resolve() if args.sw_before else sw_after

    lines: list[str] = []

    def log(message: str):
        print(message, flush=True)
        lines.append(message)

    tmp = Path(tempfile.mkdtemp(prefix="sw-verify-"))
    site = tmp / "site"
    shutil.copytree(repo, site, ignore=shutil.ignore_patterns(".git", "docs", "scripts"))
    profile = tmp / "profile"

    log(f"repo       : {repo}")
    log(f"sw (visit1): {sw_before}")
    log(f"sw (visit2): {sw_after}")
    log("")

    result = {"checks": [], "before": None, "after": None, "offline": None, "hung": None, "update": None, "log": lines}
    try:
        with sync_playwright() as pw:
            log(f"chromium   : {Path(pw.chromium.executable_path).name}")
            visits = Visits(pw, profile)
            try:
                result["before"] = first_visit(visits, site, sw_before, BUILD_1, log)
                deploy_build(site, BUILD_2)  # game.js だけ差し替え（擬似デプロイ）
                same_sw = sw_before.read_bytes() == sw_after.read_bytes()
                log(f"[deploy]   game.js を {BUILD_1} -> {BUILD_2} に差し替え / sw.js: {'変更なし' if same_sw else '差し替え'}")
                update, online, offline = second_visit(visits, sw_after, BUILD_2, log)
                hung = hang_visit(visits, log) if args.expect_fresh else None
                result["update"] = update
                result["after"] = online
                result["offline"] = offline
                result["hung"] = hung
            finally:
                visits.close()
        result["checks"] = evaluate(offline, online, hung, args.expect_fresh)
    finally:
        if args.keep_temp:
            log(f"\n(temp) {tmp}")
        else:
            shutil.rmtree(tmp, ignore_errors=True)

    log("")
    log("=== 判定 ===")
    for c in result["checks"]:
        log(f"  [{'PASS' if c['ok'] else 'FAIL'}] {c['name']}  <- {c['detail']}")
    passed = all(c["ok"] for c in result["checks"])
    log("")
    log(f"結果: {'PASS' if passed else 'FAIL'}")

    if args.json:
        Path(args.json).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        log(f"JSON: {args.json}")
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())