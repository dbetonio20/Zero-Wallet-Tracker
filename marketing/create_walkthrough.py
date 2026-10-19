#!/usr/bin/env python3
"""Render a 15-second dark-mode Salapi app walkthrough."""

from __future__ import annotations

import argparse
import html
from pathlib import Path

from create_intro import render_video

WIDTH = 720
HEIGHT = 1280
BACKGROUND = '#101612'
SURFACE = '#1a231c'
CARD = '#1c2820'
BORDER = '#2d3a30'
INK = '#f1f5ef'
MUTED = '#a0ada2'
GREEN = '#62d98b'
GREEN_SOFT = '#1b3b28'
LIME = '#c8f36a'
AMBER = '#f2c16b'


def label(x: int, y: int, text: str, *, size: int = 19, color: str = MUTED,
          weight: int = 500, spacing: int = 0) -> str:
    return (
        f'<text x="{x}" y="{y}" fill="{color}" font-family="DejaVu Sans, sans-serif" '
        f'font-size="{size}" font-weight="{weight}" letter-spacing="{spacing}">'
        f'{html.escape(text)}</text>'
    )


def headline(x: int, y: int, content: list[str], *, size: int = 52,
             color: str = INK, leading: int = 64) -> str:
    return ''.join(
        f'<text x="{x}" y="{y + index * leading}" fill="{color}" '
        f'font-family="DejaVu Sans, sans-serif" font-size="{size}" '
        f'font-weight="700">{html.escape(line)}</text>'
        for index, line in enumerate(content)
    )


def brand(x: int = 54, y: int = 98) -> str:
    return (
        f'<circle cx="{x + 20}" cy="{y - 8}" r="20" fill="{GREEN}"/>'
        f'<path d="M{x + 12} {y - 8}h16m-8-8v16" stroke="{BACKGROUND}" '
        'stroke-width="3" stroke-linecap="round"/>'
        f'<text x="{x + 52}" y="{y}" fill="{INK}" '
        'font-family="DejaVu Sans, sans-serif" font-size="29" font-weight="700">salapi</text>'
    )


def background() -> str:
    return f'''
      <rect width="{WIDTH}" height="{HEIGHT}" fill="{BACKGROUND}"/>
      <path d="M0 164H720M0 1120H720" stroke="{BORDER}" stroke-width="1"/>
      <circle cx="642" cy="152" r="118" fill="#17241a"/>
      <circle cx="642" cy="152" r="70" fill="#1b3020"/>
    '''


def panel(x: int, y: int, width: int, height: int, content: str) -> str:
    return (
        f'<rect x="{x}" y="{y}" width="{width}" height="{height}" rx="28" '
        f'fill="{CARD}" stroke="{BORDER}" stroke-width="1.5"/>{content}'
    )


def progress_bar(x: int, y: int, width: int, amount: float, color: str = GREEN) -> str:
    return (
        f'<rect x="{x}" y="{y}" width="{width}" height="12" rx="6" fill="#303b33"/>'
        f'<rect x="{x}" y="{y}" width="{width * amount:.0f}" height="12" rx="6" fill="{color}"/>'
    )


def header_step(number: str, text: str) -> str:
    return ''.join([
        brand(),
        label(56, 220, f'{number}  ·  {text}', size=15, color=GREEN, weight=700, spacing=2),
    ])


def overview_panel() -> str:
    content = ''.join([
        label(104, 564, 'OCTOBER OVERVIEW', size=15, color=GREEN, weight=700, spacing=2),
        label(104, 620, 'Available to plan', size=19),
        label(104, 680, 'PHP 12,600', size=42, color=INK, weight=700),
        '<path d="M104 711H616" stroke="#344137" stroke-width="1"/>',
        label(104, 755, 'Income', size=17),
        label(492, 755, 'PHP 35,000', size=17, color=INK, weight=700),
        label(104, 806, 'Committed', size=17),
        label(492, 806, 'PHP 22,400', size=17, color=INK, weight=700),
        progress_bar(104, 837, 512, 0.64),
        '<circle cx="113" cy="901" r="6" fill="#62d98b"/>',
        label(132, 908, 'Your monthly snapshot, all in one place', size=16, color=INK),
        '<rect x="104" y="955" width="512" height="74" rx="18" fill="#202e24"/>',
        label(128, 987, 'NEXT UP', size=13, color=MUTED, weight=700, spacing=1),
        label(128, 1014, 'Rent · PHP 12,000', size=17, color=INK, weight=600),
        '<circle cx="578" cy="992" r="19" fill="#304934"/>',
        '<path d="M574 984l8 8-8 8" fill="none" stroke="#62d98b" stroke-width="3" '
        'stroke-linecap="round" stroke-linejoin="round"/>',
    ])
    return panel(72, 505, 576, 590, content)


def bills_panel() -> str:
    rows = [
        ('Rent', 'Due in 2 days', 'PHP 12,000', AMBER, 'R'),
        ('Electricity', 'Due in 4 days', 'PHP 1,850', GREEN, 'E'),
        ('Internet', 'Due in 6 days', 'PHP 1,299', '#8ab8f4', 'I'),
    ]
    content = [
        label(104, 564, 'UPCOMING BILLS', size=15, color=GREEN, weight=700, spacing=2),
        label(104, 611, 'Plan for what’s next', size=25, color=INK, weight=700),
        '<path d="M104 638H616" stroke="#344137" stroke-width="1"/>',
    ]
    for index, (name, due, amount, color, initial) in enumerate(rows):
        row_y = 704 + index * 104
        content.extend([
            f'<circle cx="130" cy="{row_y - 8}" r="24" fill="#26352a"/>',
            label(123, row_y, initial, size=17, color=color, weight=700),
            label(170, row_y - 8, name, size=18, color=INK, weight=700),
            label(170, row_y + 22, due, size=15, color=MUTED),
            label(474, row_y, amount, size=16, color=INK, weight=700),
            f'<path d="M104 {row_y + 44}H616" stroke="{BORDER}" stroke-width="1"/>',
        ])
    content.extend([
        '<rect x="104" y="1010" width="512" height="52" rx="16" fill="#203b29"/>',
        '<circle cx="130" cy="1036" r="10" fill="#62d98b"/>',
        '<path d="M125 1036l4 4 7-8" fill="none" stroke="#101612" stroke-width="2.5" '
        'stroke-linecap="round" stroke-linejoin="round"/>',
        label(153, 1043, 'Check due dates before they sneak up', size=16, color=GREEN, weight=600),
    ])
    return panel(72, 505, 576, 590, ''.join(content))


def allocation_panel() -> str:
    rows = [
        ('Home', 'PHP 12,000', 0.74, GREEN),
        ('Everyday', 'PHP 6,400', 0.47, '#83dba0'),
        ('Savings', 'PHP 4,000', 0.31, LIME),
    ]
    content = [
        label(104, 564, 'ALLOCATE INCOME', size=15, color=GREEN, weight=700, spacing=2),
        label(104, 611, 'Salary · PHP 35,000', size=24, color=INK, weight=700),
        label(104, 651, 'Give each part a job', size=16),
        '<path d="M104 677H616" stroke="#344137" stroke-width="1"/>',
    ]
    for index, (name, amount, progress, color) in enumerate(rows):
        row_y = 737 + index * 96
        content.extend([
            label(104, row_y, name, size=17, color=INK, weight=700),
            label(487, row_y, amount, size=16, color=INK, weight=600),
            progress_bar(104, row_y + 18, 512, progress, color),
        ])
    content.extend([
        '<rect x="104" y="1012" width="512" height="50" rx="16" fill="#203b29"/>',
        label(132, 1044, 'Make the plan match your priorities', size=16, color=GREEN, weight=600),
    ])
    return panel(72, 505, 576, 590, ''.join(content))


def savings_panel() -> str:
    content = ''.join([
        label(104, 564, 'SAVINGS GOAL', size=15, color=GREEN, weight=700, spacing=2),
        '<circle cx="147" cy="642" r="28" fill="#263c2b"/>',
        '<path d="M137 642l7 7 14-16" fill="none" stroke="#62d98b" stroke-width="4" '
        'stroke-linecap="round" stroke-linejoin="round"/>',
        label(194, 638, 'Emergency fund', size=21, color=INK, weight=700),
        label(194, 668, 'Keep building it at your pace', size=15),
        label(104, 758, 'PHP 18,000', size=34, color=INK, weight=700),
        label(405, 758, 'of PHP 25,000', size=17),
        progress_bar(104, 786, 512, 0.72),
        '<rect x="104" y="849" width="512" height="1" fill="#344137"/>',
        label(104, 901, '72% there', size=18, color=GREEN, weight=700),
        '<circle cx="555" cy="895" r="34" fill="#253b29"/>',
        '<path d="M555 914v-38m-13 13 13-13 13 13" fill="none" stroke="#62d98b" '
        'stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>',
        '<rect x="104" y="978" width="512" height="68" rx="18" fill="#202e24"/>',
        label(128, 1007, 'A little progress', size=14, color=MUTED),
        label(128, 1032, 'still moves you forward.', size=17, color=INK, weight=600),
    ])
    return panel(72, 505, 576, 590, content)


def scene_svg(scene: int) -> str:
    content = background()
    if scene == 0:
        content += ''.join([
            header_step('01', 'YOUR MONTH AT A GLANCE'),
            headline(52, 312, ['Start with the', 'full picture.']),
            label(57, 446, 'A quick read of what’s available and committed.', size=17),
            overview_panel(),
        ])
    elif scene == 1:
        content += ''.join([
            header_step('02', 'UPCOMING EXPENSES'),
            headline(52, 312, ['See what’s due', 'before it arrives.']),
            label(57, 446, 'Scan bills and due dates in one place.', size=17),
            bills_panel(),
        ])
    elif scene == 2:
        content += ''.join([
            header_step('03', 'INCOME ALLOCATION'),
            headline(52, 312, ['Give every peso', 'a purpose.']),
            label(57, 446, 'Break income into the things that matter.', size=17),
            allocation_panel(),
        ])
    elif scene == 3:
        content += ''.join([
            header_step('04', 'SAVINGS GOALS'),
            headline(52, 312, ['Keep your goals', 'moving forward.']),
            label(57, 446, 'Track progress without losing sight of today.', size=17),
            savings_panel(),
        ])
    else:
        content = ''.join([
            '<rect width="720" height="1280" fill="#14271a"/>',
            '<circle cx="598" cy="208" r="205" fill="#62d98b" opacity=".08"/>',
            '<circle cx="598" cy="208" r="132" fill="#62d98b" opacity=".06"/>',
            brand(56, 108),
            '<circle cx="360" cy="436" r="91" fill="#c8f36a"/>',
            '<path d="M323 436h74m-37-37v74" stroke="#101612" stroke-width="10" '
            'stroke-linecap="round"/>',
            headline(52, 658, ['Know your money.', 'Choose your next', 'move with clarity.'],
                     size=45, leading=61),
            '<path d="M56 914H664" stroke="#47664f" stroke-width="1.5"/>',
            label(57, 976, 'Your money, on purpose.', size=21, color=GREEN, weight=600),
            label(57, 1190, 'SALAPI  ·  PERSONAL FINANCE', size=14, color='#a9cbb0', spacing=2),
        ])
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{WIDTH}" height="{HEIGHT}" '
        f'viewBox="0 0 {WIDTH} {HEIGHT}">{content}</svg>'
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        'output',
        nargs='?',
        type=Path,
        default=Path(__file__).with_name('salapi-walkthrough.mp4'),
        help='output MP4 path (default: marketing/salapi-walkthrough.mp4)',
    )
    args = parser.parse_args()
    render_video(args.output, scene_factory=scene_svg)
    print(f'Created {args.output}')


if __name__ == '__main__':
    main()
