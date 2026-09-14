#!/usr/bin/env python3
"""对 RapidOCRAPI POST /ocr 做命令行压测，打印 QPS 与延迟分位。"""
from __future__ import annotations

import argparse
import statistics
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import List, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def _percentile(sorted_ms: List[float], p: float) -> float:
    if not sorted_ms:
        return 0.0
    if len(sorted_ms) == 1:
        return sorted_ms[0]
    k = (len(sorted_ms) - 1) * (p / 100.0)
    lo = int(k)
    hi = min(lo + 1, len(sorted_ms) - 1)
    frac = k - lo
    return sorted_ms[lo] * (1.0 - frac) + sorted_ms[hi] * frac


def _multipart(field: str, filename: str, data: bytes, boundary: str) -> bytes:
    parts = [
        f"--{boundary}".encode(),
        f'Content-Disposition: form-data; name="{field}"; filename="{filename}"'.encode(),
        b"Content-Type: application/octet-stream",
        b"",
        data,
        f"--{boundary}--".encode(),
        b"",
    ]
    return b"\r\n".join(parts)


def _one_request(url: str, body: bytes, content_type: str, timeout: float) -> Tuple[bool, float]:
    req = Request(url, data=body, method="POST", headers={"Content-Type": content_type})
    started = time.perf_counter()
    try:
        with urlopen(req, timeout=timeout) as resp:
            resp.read()
            ok = 200 <= resp.status < 300
    except (HTTPError, URLError, TimeoutError, OSError):
        ok = False
    elapsed_ms = (time.perf_counter() - started) * 1000.0
    return ok, elapsed_ms


def main(argv: Optional[list] = None) -> int:
    parser = argparse.ArgumentParser(description="RapidOCR /ocr 命令行压测")
    parser.add_argument("--url", default="http://127.0.0.1:9003/ocr", help="OCR 接口地址")
    parser.add_argument(
        "--image",
        default=str(Path(__file__).resolve().parent / "sample.png"),
        help="样图文件或含 png/jpg 的目录",
    )
    parser.add_argument("--concurrency", type=int, default=4, help="并发数")
    parser.add_argument(
        "--requests",
        type=int,
        default=0,
        help="总请求次数；0 表示目录下一图一次，单文件则 20",
    )
    parser.add_argument("--timeout", type=float, default=60.0, help="单次超时秒数")
    args = parser.parse_args(argv)

    image_path = Path(args.image)
    if image_path.is_dir():
        files = sorted(
            [
                p
                for p in image_path.iterdir()
                if p.suffix.lower() in {".png", ".jpg", ".jpeg"} and p.is_file()
            ]
        )
    else:
        files = [image_path]
    if not files:
        raise SystemExit(f"没有可用图片: {image_path}")

    boundary = "----rapidocrBenchBoundary"
    payloads = []
    for p in files:
        body = _multipart("image_file", p.name, p.read_bytes(), boundary)
        payloads.append(body)
    content_type = f"multipart/form-data; boundary={boundary}"

    n = args.requests if args.requests > 0 else (len(files) if image_path.is_dir() else 20)
    n = max(1, n)
    conc = max(1, args.concurrency)
    latencies: List[float] = []
    failures = 0

    wall_start = time.perf_counter()
    with ThreadPoolExecutor(max_workers=conc) as pool:
        futs = [
            pool.submit(_one_request, args.url, payloads[i % len(payloads)], content_type, args.timeout)
            for i in range(n)
        ]
        for fut in as_completed(futs):
            ok, ms = fut.result()
            latencies.append(ms)
            if not ok:
                failures += 1
    wall = time.perf_counter() - wall_start

    success = n - failures
    qps = (n / wall) if wall > 0 else 0.0
    ok_ms = sorted(latencies)
    avg = statistics.mean(ok_ms) if ok_ms else 0.0

    print(f"url={args.url}")
    print(f"image={image_path}")
    print(f"images={len(files)}")
    print(f"requests={n} concurrency={conc} wall_s={wall:.3f}")
    print(f"success={success} failures={failures}")
    print(f"QPS={qps:.2f}")
    print(f"avg_ms={avg:.1f}")
    print(f"p50_ms={_percentile(ok_ms, 50):.1f}")
    print(f"p95_ms={_percentile(ok_ms, 95):.1f}")
    print(f"p99_ms={_percentile(ok_ms, 99):.1f}")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
