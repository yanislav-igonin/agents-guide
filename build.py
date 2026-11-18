"""Build index.html from the Obsidian draft.

python3 build.py            -> ./index.html with ./style.css (production)
python3 build.py designs/N  -> designs/N/index.html with designs/N/{style.css,head.html,hero.html}
Needs `markdown` (uv run --with markdown python build.py).
"""
import pathlib, re, sys, time
import markdown

ROOT = pathlib.Path(__file__).parent
SRC = pathlib.Path.home() / 'Documents/Obsidian/main/projects/agent-guide/Гайд — черновик.md'
DESC = 'Ставим ИИ-агента Hermes на дешевой модели, подключаем телегу и голос, делаем игры, плагины, ботов и выкладываем в интернет.'


def slug(s):
    return re.sub(r'[^\w-]+', '-', s.lower()).strip('-')


def body_html():
    text = SRC.read_text()
    text = re.sub(r'\A---\n.*?\n---\n', '', text, flags=re.S)                    # frontmatter
    text = re.sub(r'^> \[!todo\].*?(?=\n(?!>))\n', '', text, flags=re.S | re.M)  # notes for us
    title = re.search(r'^# (.+)$', text, re.M).group(1).split(' — ')[0]
    text = re.sub(r'^# .+\n', '', text, count=1, flags=re.M)
    text = re.sub(r'\[\[#([^\]|]+)\]\]', lambda m: f'[{m.group(1)}](#{slug(m.group(1))})', text)
    html = markdown.markdown(text, extensions=['fenced_code', 'toc', 'sane_lists'],
                             extension_configs={'toc': {'slugify': lambda s, sep: slug(s)}})
    html = re.sub(r'<pre><code>(.*?)</code></pre>',
                  lambda m: ('<div class="prompt"><pre><code>%s</code></pre><button type="button">Скопировать</button></div>'
                             if re.search('[а-яё]', m.group(1), re.I) else  # Russian = message to the agent
                             '<div class="cmd"><pre><code>%s</code></pre><button type="button">Скопировать</button></div>')
                  % m.group(1), html, flags=re.S)
    html = re.sub(r'(<h2 id="[^"]+">)Шаг (\d+)\. ', r'\1<span class="num">\2</span> ', html)
    # one <section> per h2 so a design can style each part as a unit
    parts = re.split(r'(?=<h2 id=")', html)
    sec = lambda p: '<section class="s-%s">%s</section>' % (re.match(r'<h2 id="([^"]+)"', p).group(1), p)
    html = parts[0] + ''.join(sec(p) for p in parts[1:])
    return title, html


def build(out_dir):
    title, html = body_html()
    read = lambda n: (out_dir / n).read_text() if (out_dir / n).exists() else ''
    hero = read('hero.html').replace('{title}', title) or f'<header class="hero"><h1>{title}</h1></header>'
    v = int(time.time())
    (out_dir / 'index.html').write_text(f'''<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{DESC}">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{DESC}">
{read('head.html')}
<link rel="stylesheet" href="style.css?v={v}">
</head>
<body>
{hero}
<main>
{html}
</main>
<footer class="foot"><p>Этот сайт собрал ИИ-агент из заметки в Обсидиане.</p></footer>
<script>
document.querySelectorAll('.prompt button, .cmd button').forEach(b => b.onclick = () =>
  navigator.clipboard.writeText(b.previousElementSibling.textContent).then(() => {{
    b.textContent = 'Скопировано'; setTimeout(() => b.textContent = 'Скопировать', 1500)
  }}))
</script>
</body>
</html>
''')
    print('ok', out_dir / 'index.html')


if __name__ == '__main__':
    build(ROOT / sys.argv[1] if len(sys.argv) > 1 else ROOT)
