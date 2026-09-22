"""生成「我的待办」应用图标（PWA / 桌面快捷方式 / favicon 共用一套视觉）。

用法： python tools/make-icons.py
输出： icons/ 目录下的 png/ico
"""
import os
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")
SS = 4                      # 超采样倍数，边缘更干净
BASE = 1024                 # 基准尺寸
W = BASE * SS

START = (77, 162, 255)      # #4DA2FF  iOS 系统蓝的亮端
END = (0, 122, 255)         # #007AFF  systemBlue


def gradient(size):
    """左上到右下的线性渐变。"""
    img = Image.new("RGB", (256, 256))
    px = img.load()
    for y in range(256):
        for x in range(256):
            t = (x + y) / 510.0
            px[x, y] = tuple(round(START[i] + (END[i] - START[i]) * t) for i in range(3))
    return img.resize((size, size), Image.LANCZOS)


def rounded_mask(size, radius_ratio=0.235):
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    r = round(size * radius_ratio)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=255)
    return mask


def draw_check(draw, size, inset=1.0):
    """白色对勾。设计稿坐标以 1024 为基准、中心在 (512,512)，按画布尺寸等比映射。"""
    s = size / 1024.0
    cx = cy = size / 2
    pts = [(330, 530), (455, 655), (700, 390)]
    pts = [(cx + (x - 512) * s * inset, cy + (y - 512) * s * inset) for x, y in pts]
    lw = max(2, round(96 * s * inset))
    # 圆头圆角：线段 + 拐点补圆
    draw.line([pts[0], pts[1]], fill=(255, 255, 255, 255), width=lw, joint="curve")
    draw.line([pts[1], pts[2]], fill=(255, 255, 255, 255), width=lw, joint="curve")
    for p in pts:
        r = lw / 2
        draw.ellipse([p[0] - r, p[1] - r, p[0] + r, p[1] + r], fill=(255, 255, 255, 255))


def make_icon(size, maskable=False, rounded=True, bg_bleed=False):
    """生成一张图标。maskable 时把对勾缩小到安全区内。"""
    ss_size = size * SS if size * SS >= W else W
    canvas = Image.new("RGBA", (ss_size, ss_size), (0, 0, 0, 0))

    if bg_bleed or maskable:
        # 满幅渐变（maskable 由系统裁切，苹果图标不留透明边）
        bg = gradient(ss_size).convert("RGBA")
        canvas.paste(bg, (0, 0))
    else:
        bg = gradient(ss_size).convert("RGBA")
        bg.putalpha(rounded_mask(ss_size))
        canvas.paste(bg, (0, 0), bg)

    draw = ImageDraw.Draw(canvas)
    draw_check(draw, ss_size, inset=0.80 if maskable else 1.0)

    return canvas.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)

    # 普通图标（圆角）
    for size in (192, 512):
        make_icon(size).save(os.path.join(OUT, f"icon-{size}.png"))
    # maskable：满幅 + 缩小主体，适配安卓自适应图标
    for size in (192, 512):
        make_icon(size, maskable=True).save(os.path.join(OUT, f"icon-maskable-{size}.png"))
    # iOS 主屏图标：不留透明
    make_icon(180, maskable=True).save(os.path.join(OUT, "apple-touch-icon.png"))
    # Windows 快捷方式 / 任务栏用的大图
    make_icon(256).save(os.path.join(OUT, "icon-256.png"))

    # favicon.ico 多尺寸，浏览器标签页用
    ico_sizes = [16, 24, 32, 48, 64]
    base = make_icon(256)
    base.save(os.path.join(OUT, "favicon.ico"), sizes=[(s, s) for s in ico_sizes])

    # app.ico：桌面客户端（Electron）用，含 256 尺寸，任务栏和 Alt+Tab 才清晰
    app_sizes = [16, 24, 32, 48, 64, 128, 256]
    make_icon(256).save(os.path.join(OUT, "app.ico"), sizes=[(s, s) for s in app_sizes])

    for f in sorted(os.listdir(OUT)):
        p = os.path.join(OUT, f)
        print(f"{f:28s} {os.path.getsize(p):>8,d} bytes")


if __name__ == "__main__":
    main()
