#!/usr/bin/env python3
"""Smoke-test the built web site.

Default: serves web/ on a random port and checks key routes.
--test:  creates a temp directory with minimal mock files and checks those.
"""

import http.server
import json
import os
import shutil
import sys
import tempfile
import threading
import urllib.request

CHECKS = [
    # (path, expected_status, content_check, case_insensitive)
    ("/", 200, "vram.run", False),
    ("/models/", 200, "All Models", False),
    ("/hardware/", 200, "All Hardware", False),
    ("/providers/", 200, "All Providers", False),
    ("/cloud/", 200, "Cloud GPU", False),
    ("/state-of-inference/", 200, "State of Inference", False),
    ("/404.html", 200, "not found", True),
    ("/app.js", 200, "import", False),
    ("/style.css", 200, "--bg", False),
    ("/data/models.json", 200, "__json_array__", False),
    ("/data/hardware.json", 200, "__json_array__", False),
]


def build_mock_site(tmpdir):
    """Create minimal files that satisfy the smoke checks."""
    os.makedirs(os.path.join(tmpdir, "models"), exist_ok=True)
    os.makedirs(os.path.join(tmpdir, "hardware"), exist_ok=True)
    os.makedirs(os.path.join(tmpdir, "providers"), exist_ok=True)
    os.makedirs(os.path.join(tmpdir, "cloud"), exist_ok=True)
    os.makedirs(os.path.join(tmpdir, "state-of-inference"), exist_ok=True)
    os.makedirs(os.path.join(tmpdir, "data"), exist_ok=True)

    write = lambda p, c: open(os.path.join(tmpdir, p), "w").write(c)

    write("index.html", "<html><body>vram.run</body></html>")
    write("models/index.html", "<html><body>All Models</body></html>")
    write("hardware/index.html", "<html><body>All Hardware</body></html>")
    write("providers/index.html", "<html><body>All Providers</body></html>")
    write("cloud/index.html", "<html><body>Cloud GPU Pricing</body></html>")
    write("state-of-inference/index.html", "<html><body>State of Inference</body></html>")
    write("404.html", "<html><body>Page not found</body></html>")
    write("app.js", "import { foo } from './lib/foo.js';")
    write("style.css", ":root { --bg: #111; }")
    write("data/models.json", json.dumps([{"id": "test/model"}]))
    write("data/hardware.json", json.dumps([{"key": "test-gpu"}]))


def start_server(directory, port):
    handler = lambda *a, **k: http.server.SimpleHTTPRequestHandler(
        *a, directory=directory, **k
    )
    srv = http.server.HTTPServer(("127.0.0.1", port), handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    return srv


def run_checks(port):
    passed = 0
    failed = 0

    for path, expected_status, content_check, case_insensitive in CHECKS:
        url = f"http://127.0.0.1:{port}{path}"
        label = path
        try:
            req = urllib.request.Request(url)
            resp = urllib.request.urlopen(req)
            status = resp.status
            body = resp.read().decode("utf-8", errors="replace")
        except urllib.error.HTTPError as e:
            status = e.code
            body = e.read().decode("utf-8", errors="replace")
        except Exception as e:
            print(f"  FAIL  {label}  -- {e}")
            failed += 1
            continue

        # Status check
        if status != expected_status:
            print(f"  FAIL  {label}  -- status {status}, expected {expected_status}")
            failed += 1
            continue

        # Content check
        if content_check == "__json_array__":
            try:
                data = json.loads(body)
                if not isinstance(data, list) or len(data) == 0:
                    print(f"  FAIL  {label}  -- not a non-empty JSON array")
                    failed += 1
                    continue
            except json.JSONDecodeError as e:
                print(f"  FAIL  {label}  -- invalid JSON: {e}")
                failed += 1
                continue
        else:
            haystack = body.lower() if case_insensitive else body
            needle = content_check.lower() if case_insensitive else content_check
            if needle not in haystack:
                print(f"  FAIL  {label}  -- missing '{content_check}'")
                failed += 1
                continue

        print(f"  ok    {label}")
        passed += 1

    return passed, failed


def find_free_port():
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def main():
    test_mode = "--test" in sys.argv

    if test_mode:
        tmpdir = tempfile.mkdtemp(prefix="smoke-web-")
        build_mock_site(tmpdir)
        webdir = tmpdir
    else:
        webdir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "web")
        if not os.path.isdir(webdir):
            print(f"error: web directory not found at {webdir}")
            sys.exit(1)

    port = find_free_port()
    srv = start_server(webdir, port)

    print(f"Smoke testing {'mock site' if test_mode else webdir} on port {port}")
    print()

    passed, failed = run_checks(port)

    srv.shutdown()
    if test_mode:
        shutil.rmtree(tmpdir, ignore_errors=True)

    print()
    print(f"{passed} passed, {failed} failed")

    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
