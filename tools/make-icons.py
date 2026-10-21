#!/usr/bin/env python3
"""Generates the MyTube toolbar icons (no third-party dependencies)."""

import math
import os
import struct
import zlib

SIZE = 512
SS = 4  # supersampling factor
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")

RED = (255, 0, 51, 255)
WHITE = (255, 255, 255, 255)

TRIANGLE = [(0.375, 0.265), (0.375, 0.735), (0.755, 0.5)]


def inside_rounded_rect(x, y, size, radius):
    if x < 0 or y < 0 or x > size or y > size:
        return False
    cx = min(max(x, radius), size - radius)
    cy = min(max(y, radius), size - radius)
    return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2


def inside_triangle(x, y):
    (x1, y1), (x2, y2), (x3, y3) = TRIANGLE
    d1 = (x - x2) * (y1 - y2) - (x1 - x2) * (y - y2)
    d2 = (x - x3) * (y2 - y3) - (x2 - x3) * (y - y3)
    d3 = (x - x1) * (y3 - y1) - (x3 - x1) * (y - y1)
    has_neg = d1 < 0 or d2 < 0 or d3 < 0
    has_pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (has_neg and has_pos)


def render(size):
    radius = size * 0.23
    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            r = g = b = a = 0
            for sy in range(SS):
                for sx in range(SS):
                    x = px + (sx + 0.5) / SS
                    y = py + (sy + 0.5) / SS
                    if inside_rounded_rect(x, y, size, radius):
                        color = WHITE if inside_triangle(x / size, y / size) else RED
                        r += color[0]
                        g += color[1]
                        b += color[2]
                        a += 255
            samples = SS * SS
            if a == 0:
                row.extend((0, 0, 0, 0))
            else:
                covered = a // 255
                row.extend((r // covered, g // covered, b // covered, a // samples))
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    raw = b"".join(b"\x00" + row for row in rows)

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")

    with open(path, "wb") as handle:
        handle.write(png)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in (16, 32, 48, 128):
        write_png(os.path.join(OUT_DIR, f"icon{size}.png"), size, render(size))
        print(f"wrote icons/icon{size}.png")


if __name__ == "__main__":
    main()
