"""WebPの透過から紙型の設計資料を採る。素材画像自体は変更しない。要Pillow。"""
import json
from collections import deque
from pathlib import Path
from PIL import Image, ImageFilter

ROOT = Path(__file__).parent

def simplify(points, epsilon):
    if len(points) < 3:
        return points
    a, b = points[0], points[-1]
    dx, dy = b[0] - a[0], b[1] - a[1]
    norm = (dx * dx + dy * dy) ** .5
    distances = [abs(dy * (p[0] - a[0]) - dx * (p[1] - a[1])) / norm if norm else ((p[0] - a[0]) ** 2 + (p[1] - a[1]) ** 2) ** .5 for p in points]
    index = max(range(len(points)), key=lambda i: distances[i])
    if distances[index] <= epsilon:
        return [a, b]
    return simplify(points[:index + 1], epsilon)[:-1] + simplify(points[index:], epsilon)

def boundary(cells):
    edges = {}
    for x, y in cells:
        for neighbor, a, b in [((x, y - 1), (x, y), (x + 1, y)), ((x + 1, y), (x + 1, y), (x + 1, y + 1)),
                                ((x, y + 1), (x + 1, y + 1), (x, y + 1)), ((x - 1, y), (x, y + 1), (x, y))]:
            if neighbor not in cells:
                edges.setdefault(a, []).append(b)
    loops = []
    while edges:
        start = next(iter(edges)); at = start; loop = [at]
        while True:
            end = edges[at].pop()
            if not edges[at]: del edges[at]
            at = end; loop.append(at)
            if at == start: break
        loops.append(loop)
    loop = max(loops, key=len)
    half = len(loop) // 2
    return simplify(loop[:half + 1], 1.1)[:-1] + simplify(loop[half:], 1.1)[:-1]

result = {}
for work in ['forest_lantern', 'morning_walk', 'four_seasons', 'crooked_castle']:
    result[work] = {}
    for file in sorted((ROOT / 'assets' / work).glob('*.webp')):
        image = Image.open(file).convert('RGBA')
        alpha = image.getchannel('A'); alpha.thumbnail((240, 240))
        width, height = alpha.size
        # 外周は上部の輪郭を採り、接地線と支持のための下部は生成時に設計する。
        pixels = alpha.load(); rows = []
        for y in range(height):
            xs = [x for x in range(width) if pixels[x, y] >= 100]
            if xs: rows.append((y, min(xs), max(xs) + 1))
        if not rows: continue
        left = [(a, y) for y, a, b in rows]; right = [(b, y) for y, a, b in rows]
        envelope = simplify(left, 1.2) + simplify(list(reversed(right)), 1.2)
        normalize = lambda points: [[round(x / width, 6), round(1 - y / height, 6)] for x, y in points]
        entry = {'outer': normalize(envelope), 'left': normalize(simplify(left, 1.2)), 'right': normalize(simplify(right, 1.2))}
        if file.name == 'window-frame.webp':
            opaque = alpha.filter(ImageFilter.MaxFilter(3)).load()
            unseen = {(x, y) for y in range(height) for x in range(width) if opaque[x, y] < 90}
            holes = []
            while unseen:
                seed = unseen.pop(); cells = {seed}; queue = deque([seed]); edge = False
                while queue:
                    x, y = queue.popleft()
                    edge |= x == 0 or y == 0 or x == width - 1 or y == height - 1
                    for n in [(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)]:
                        if n in unseen:
                            unseen.remove(n); cells.add(n); queue.append(n)
                if edge or len(cells) < width * height * .004: continue
                holes.append([[round(x / width, 6), round(1 - y / height, 6)] for x, y in boundary(cells)])
            entry['holes'] = holes
        result[work][file.name] = entry
(ROOT / 'paper-shapes.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
print('紙型資料:', {work: len(shapes) for work, shapes in result.items()})
print('窓の穴:', {work: len(shapes.get('window-frame.webp', {}).get('holes', [])) for work, shapes in result.items()})
