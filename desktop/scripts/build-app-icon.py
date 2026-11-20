"""从一张源图生成应用图标全套资源。

用法：
    python scripts/build-app-icon.py [源图路径]

源图默认是 build/app-icon-source.png。产物：

    build/icon.png                 512×512  窗体 / Alt-Tab 图标
    build/tray.png                  32×32   托盘图标
    build/icon.ico                  多尺寸   安装包与 exe 的图标
    ../web/client/public/favicon.png 64×64  网页 favicon

为什么统一加圆角：应用里其余图标（build/icons/*.png、favicon）都是「圆角 + 透明
边」，任务栏/开始菜单在深色浅色背景上都不会糊成一块白方片。圆角半径取边长的
22%，和现有资源的观感一致。

源图本身不裁不改，只缩放和加圆角——所以它就是设计稿，改完重跑这个脚本即可。
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BUILD = ROOT / "build"
DEFAULT_SOURCE = BUILD / "app-icon-source.png"

# 圆角半径 = 边长 × 这个比例，和现有图标的观感一致。
CORNER_RATIO = 0.22

SIZES = {
    "icon.png": (512, 512),
    "tray.png": (32, 32),
}
FAVICON = (64, 64)
ICO_SIZES = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (256, 256)]


def rounded(image: Image.Image, radius: int) -> Image.Image:
    """给图加圆角，四角变透明。"""
    from PIL import ImageDraw

    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, image.size[0] - 1, image.size[1] - 1], radius=radius, fill=255
    )
    out = image.convert("RGBA")
    out.putalpha(mask)
    return out


def render(source: Image.Image, size: tuple[int, int]) -> Image.Image:
    side = min(size)
    return rounded(source.resize(size, Image.Resampling.LANCZOS), max(1, int(side * CORNER_RATIO)))


def main() -> None:
    source_path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_SOURCE
    if not source_path.is_file():
        raise SystemExit(f"找不到源图：{source_path}")

    # 先补成正方形再缩放，避免源图不是 1:1 时被压扁。
    source = Image.open(source_path).convert("RGBA")
    side = max(source.size)
    square = Image.new("RGBA", (side, side), (255, 255, 255, 255))
    square.paste(source, ((side - source.width) // 2, (side - source.height) // 2))

    BUILD.mkdir(parents=True, exist_ok=True)
    for name, size in SIZES.items():
        render(square, size).save(BUILD / name, "PNG")
        print(f"  {name:<12} {size[0]}×{size[1]}")

    ico = render(square, (256, 256))
    ico.save(BUILD / "icon.ico", format="ICO", sizes=ICO_SIZES)
    print(f"  {'icon.ico':<12} {', '.join(f'{s}×{s}' for s, _ in ICO_SIZES)}")

    favicon_dir = ROOT.parent / "web" / "client" / "public"
    favicon_dir.mkdir(parents=True, exist_ok=True)
    render(square, FAVICON).save(favicon_dir / "favicon.png", "PNG")
    print(f"  favicon.png  {FAVICON[0]}×{FAVICON[1]}  -> {favicon_dir}")


if __name__ == "__main__":
    main()
