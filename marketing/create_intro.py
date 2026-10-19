#!/usr/bin/env python3
"""Render a 15-second vertical Salapi introduction video."""

from __future__ import annotations

import argparse
import html
import os
import shutil
import subprocess
import tempfile
from collections.abc import Callable
from pathlib import Path

WIDTH = 720
HEIGHT = 1280
FPS = 30
SCENE_SECONDS = 3
BACKGROUND = '#f4f6f1'
INK = '#1d2b23'
MUTED = '#738077'
GREEN = '#16834b'
BRIGHT_GREEN = '#c8f36a'
WHITE = '#ffffff'


def label(x: int, y: int, text: str, *, size: int = 20, color: str = MUTED,
          weight: int = 600, spacing: int = 0) -> str:
    return (
        f'<text x="{x}" y="{y}" fill="{color}" font-family="DejaVu Sans, sans-serif" '
        f'font-size="{size}" font-weight="{weight}" letter-spacing="{spacing}">'
        f'{html.escape(text)}</text>'
    )


def lines(x: int, y: int, content: list[str], *, size: int = 66,
          color: str = INK, weight: int = 700, leading: int | None = None) -> str:
    line_height = leading or int(size * 1.14)
    return ''.join(
        f'<text x="{x}" y="{y + index * line_height}" fill="{color}" '
        f'font-family="DejaVu Sans, sans-serif" font-size="{size}" '
        f'font-weight="{weight}">{html.escape(line)}</text>'
        for index, line in enumerate(content)
    )


def brand(x: int = 54, y: int = 94, *, dark: bool = False) -> str:
    text_color = WHITE if dark else INK
    icon_fill = BRIGHT_GREEN if dark else GREEN
    return (
        f'<circle cx="{x + 21}" cy="{y - 8}" r="21" fill="{icon_fill}"/>'
        f'<path d="M{x + 13} {y - 7}h16m-8-8v16" stroke="{INK if dark else WHITE}" '
        'stroke-width="3" stroke-linecap="round"/>'
        f'<text x="{x + 55}" y="{y}" fill="{text_color}" '
        'font-family="DejaVu Sans, sans-serif" font-size="30" font-weight="700">salapi</text>'
    )


def background() -> str:
    return f'''
      <defs>
        <filter id="shadow" x="-30%" y="-30%" width="160%" height="170%">
          <feDropShadow dx="0" dy="18" stdDeviation="20" flood-color="#20352a" flood-opacity=".12"/>
        </filter>
      </defs>
      <rect width="{WIDTH}" height="{HEIGHT}" fill="{BACKGROUND}"/>
      <path d="M0 170H720M0 1110H720" stroke="#dfe5dc" stroke-width="1"/>
      <circle cx="645" cy="155" r="112" fill="#e7efd9"/>
      <circle cx="645" cy="155" r="67" fill="#dbe9c7"/>
    '''


def card(x: int, y: int, width: int, height: int, content: str,
         *, radius: int = 28, fill: str = WHITE) -> str:
    return (
        f'<g filter="url(#shadow)"><rect x="{x}" y="{y}" width="{width}" '
        f'height="{height}" rx="{radius}" fill="{fill}"/>{content}</g>'
    )


def phone_summary() -> str:
    content = ''.join([
        label(105, 757, 'THIS MONTH', size=16, spacing=2),
        label(105, 814, 'Your plan at a glance', size=26, color=INK, weight=700),
        '<rect x="105" y="844" width="510" height="1" fill="#e8ede7"/>',
        label(105, 895, 'Income', size=18),
        label(518, 895, 'PHP 35,000', size=18, color=INK, weight=700),
        label(105, 943, 'Planned expenses', size=18),
        label(518, 943, 'PHP 22,400', size=18, color=INK, weight=700),
        '<rect x="105" y="980" width="510" height="12" rx="6" fill="#e9eee8"/>',
        '<rect x="105" y="980" width="326" height="12" rx="6" fill="#16834b"/>',
        '<circle cx="119" cy="1034" r="6" fill="#16834b"/>',
        label(138, 1041, 'A clearer view of what you can spend', size=17, color=INK),
    ])
    return card(72, 700, 576, 395, content)


def bills_screen() -> str:
    rows = [
        ('Rent', 'Due Oct 25', 'PHP 12,000', '#e5f2e8', 'R'),
        ('Electricity', 'Due Oct 27', 'PHP 1,850', '#fff1d7', 'E'),
        ('Internet', 'Due Oct 29', 'PHP 1,299', '#e8eef8', 'I'),
    ]
    content = [
        label(104, 558, 'UPCOMING', size=16, spacing=2),
        label(104, 611, 'Bills to plan for', size=27, color=INK, weight=700),
        '<rect x="104" y="636" width="512" height="1" fill="#e8ede7"/>',
    ]
    for index, (name, due, amount, tint, initial) in enumerate(rows):
        row_y = 692 + index * 92
        content.extend([
            f'<circle cx="130" cy="{row_y - 8}" r="23" fill="{tint}"/>',
            label(122, row_y, initial, size=17, color=GREEN, weight=700),
            label(170, row_y - 8, name, size=18, color=INK, weight=700),
            label(170, row_y + 20, due, size=14),
            label(493, row_y, amount, size=16, color=INK, weight=700),
            '<rect x="104" y="{}" width="512" height="1" fill="#edf0eb"/>'.format(row_y + 39),
        ])
    content.extend([
        '<rect x="104" y="992" width="512" height="52" rx="16" fill="#e9f4ea"/>',
        label(133, 1026, 'Stay ahead of due dates', size=17, color=GREEN, weight=700),
    ])
    return card(72, 500, 576, 590, ''.join(content))


def allocation_screen() -> str:
    rows = [
        ('Home', 'PHP 12,000', 0.72, '#16834b'),
        ('Everyday', 'PHP 6,400', 0.48, '#71b78b'),
        ('Savings', 'PHP 4,000', 0.32, '#b7d993'),
    ]
    content = [
        label(104, 558, 'INCOME PLAN', size=16, spacing=2),
        label(104, 611, 'Give it a purpose', size=27, color=INK, weight=700),
        label(104, 655, 'Salary · PHP 35,000', size=17),
    ]
    for index, (name, amount, progress, color) in enumerate(rows):
        top = 718 + index * 100
        content.extend([
            label(104, top, name, size=18, color=INK, weight=700),
            label(486, top, amount, size=17, color=INK, weight=700),
            '<rect x="104" y="{}" width="512" height="11" rx="6" fill="#e9eee8"/>'.format(top + 19),
            '<rect x="104" y="{}" width="{:.0f}" height="11" rx="6" fill="{}"/>'.format(
                top + 19, 512 * progress, color
            ),
        ])
    content.extend([
        '<rect x="104" y="1010" width="512" height="52" rx="16" fill="#e9f4ea"/>',
        label(133, 1044, 'Know what your income needs to cover', size=16, color=GREEN, weight=700),
    ])
    return card(72, 500, 576, 590, ''.join(content))


def savings_screen() -> str:
    content = ''.join([
        label(104, 558, 'SAVINGS', size=16, spacing=2),
        label(104, 611, 'Make space for goals', size=27, color=INK, weight=700),
        '<circle cx="153" cy="729" r="34" fill="#e9f4ea"/>',
        '<path d="M142 729l8 8 16-18" fill="none" stroke="#16834b" stroke-width="5" '
        'stroke-linecap="round" stroke-linejoin="round"/>',
        label(205, 723, 'Emergency fund', size=20, color=INK, weight=700),
        label(205, 752, 'One step closer every month', size=15),
        label(104, 835, 'PHP 18,000', size=34, color=INK, weight=700),
        label(394, 835, 'of PHP 25,000', size=18),
        '<rect x="104" y="867" width="512" height="16" rx="8" fill="#e9eee8"/>',
        '<rect x="104" y="867" width="369" height="16" rx="8" fill="#16834b"/>',
        '<circle cx="518" cy="960" r="48" fill="#f0f6e8"/>',
        '<path d="M518 989V931m-20 19 20-20 20 20" fill="none" stroke="#16834b" '
        'stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>',
        label(104, 974, 'Small, steady progress adds up.', size=18, color=INK, weight=600),
    ])
    return card(72, 500, 576, 590, content)


def scene_svg(scene: int) -> str:
    base = background()
    if scene == 0:
        content = ''.join([
            brand(),
            label(56, 245, 'A MONEY PLAN THAT FEELS LIKE YOURS', size=14, spacing=2),
            lines(52, 359, ['Your money,', 'with a plan.'], size=72, leading=86),
            label(57, 548, 'Less guesswork. More peace of mind.', size=20, color=MUTED),
            phone_summary(),
            '<circle cx="610" cy="643" r="17" fill="#c8f36a"/>',
            '<circle cx="87" cy="654" r="8" fill="#16834b"/>',
        ])
    elif scene == 1:
        content = ''.join([
            brand(),
            label(56, 242, '01  ·  STAY AHEAD', size=15, color=GREEN, spacing=2),
            lines(52, 334, ['See what’s due.', 'Breathe easier.'], size=53, leading=67),
            label(57, 429, 'Know what’s coming before it arrives.', size=18),
            bills_screen(),
        ])
    elif scene == 2:
        content = ''.join([
            brand(),
            label(56, 242, '02  ·  PLAN WITH PURPOSE', size=15, color=GREEN, spacing=2),
            lines(52, 334, ['Give every peso', 'a place to go.'], size=53, leading=67),
            label(57, 429, 'Connect your income to real-life expenses.', size=18),
            allocation_screen(),
        ])
    elif scene == 3:
        content = ''.join([
            brand(),
            label(56, 242, '03  ·  SAVE YOUR WAY', size=15, color=GREEN, spacing=2),
            lines(52, 334, ['Make room for', 'what matters.'], size=53, leading=67),
            label(57, 429, 'Turn small steps into meaningful progress.', size=18),
            savings_screen(),
        ])
    else:
        content = ''.join([
            '<rect width="720" height="1280" fill="#16834b"/>',
            '<circle cx="583" cy="216" r="195" fill="#ffffff" opacity=".06"/>',
            '<circle cx="583" cy="216" r="130" fill="#ffffff" opacity=".04"/>',
            brand(56, 105, dark=True),
            '<circle cx="360" cy="480" r="92" fill="#c8f36a"/>',
            '<path d="M323 480h74m-37-37v74" stroke="#1d2b23" stroke-width="10" '
            'stroke-linecap="round"/>',
            lines(52, 704, ['Know your money.', 'Choose your next', 'move with clarity.'],
                  size=47, color=WHITE, leading=64),
            '<rect x="56" y="962" width="608" height="2" fill="#ffffff" opacity=".28"/>',
            label(57, 1024, 'Your money, on purpose.', size=22, color=WHITE, weight=600),
            label(57, 1196, 'SALAPI  ·  PERSONAL FINANCE', size=14, color='#d6eadb', spacing=2),
        ])
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{HEIGHT}" '
        f'viewBox="0 0 {WIDTH} {HEIGHT}">{base}{content}</svg>'
    )


def render_video(output: Path, scene_factory: Callable[[int], str] = scene_svg) -> None:
    ffmpeg = os.environ.get('FFMPEG') or shutil.which('ffmpeg')
    convert = shutil.which('convert')
    if not ffmpeg:
        raise RuntimeError('ffmpeg was not found; install it or set the FFMPEG path.')
    if not convert:
        raise RuntimeError('ImageMagick convert was not found.')

    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='salapi-intro-') as temp_name:
        temp_dir = Path(temp_name)
        images = []
        for scene in range(5):
            svg = temp_dir / f'scene-{scene}.svg'
            png = temp_dir / f'scene-{scene}.png'
            svg.write_text(scene_factory(scene), encoding='utf-8')
            subprocess.run(
                [convert, '-background', BACKGROUND, str(svg), '-resize',
                 f'{WIDTH}x{HEIGHT}!', str(png)],
                check=True,
                capture_output=True,
                text=True,
            )
            images.append(png)

        command = [ffmpeg, '-hide_banner', '-loglevel', 'error', '-y']
        for image in images:
            command.extend([
                '-loop', '1', '-framerate', str(FPS), '-t', str(SCENE_SECONDS),
                '-i', str(image),
            ])

        filters = []
        for index in range(len(images)):
            filters.append(
                f'[{index}:v]zoompan=z=\'min(zoom+0.0005,1.05)\':'
                f'x=\'iw/2-(iw/zoom/2)\':y=\'ih/2-(ih/zoom/2)\':'
                f'd=1:s={WIDTH}x{HEIGHT}:fps={FPS},setsar=1,format=yuv420p,'
                f'settb=AVTB,setpts=PTS-STARTPTS[v{index}]'
            )

        command.extend([
            '-filter_complex_threads', '1',
            '-filter_complex', ';'.join(filters) + ';' +
            ''.join(f'[v{index}]' for index in range(len(images))) +
            f'concat=n={len(images)}:v=1:a=0[out]',
            '-map', '[out]',
            '-t', '15',
            '-r', str(FPS),
            '-an',
            '-c:v', 'libx264',
            '-preset', 'medium',
            '-crf', '20',
            '-pix_fmt', 'yuv420p',
            '-movflags', '+faststart',
            str(output),
        ])
        subprocess.run(command, check=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        'output',
        nargs='?',
        type=Path,
        default=Path(__file__).with_name('salapi-intro.mp4'),
        help='output MP4 path (default: marketing/salapi-intro.mp4)',
    )
    args = parser.parse_args()
    render_video(args.output)
    print(f'Created {args.output}')


if __name__ == '__main__':
    main()
