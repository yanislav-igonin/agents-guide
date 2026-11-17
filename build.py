"""Build index.html from the Obsidian draft: python3 build.py (needs `markdown`)."""
import pathlib, re, time
import markdown

SRC = pathlib.Path.home() / 'Documents/Obsidian/main/projects/agent-guide/Гайд — черновик.md'
OUT = pathlib.Path(__file__).parent / 'index.html'

text = SRC.read_text()
text = re.sub(r'\A---\n.*?\n---\n', '', text, flags=re.S)          # frontmatter
text = re.sub(r'^> \[!todo\].*?(?=\n(?!>))\n', '', text, flags=re.S | re.M)  # notes for us
title = re.search(r'^# (.+)$', text, re.M).group(1).split(' — ')[0]
text = re.sub(r'^# .+\n', '', text, count=1, flags=re.M)

def slug(s):
    return re.sub(r'[^\w-]+', '-', s.lower()).strip('-')

# Obsidian [[#Heading]] -> markdown anchor link
text = re.sub(r'\[\[#([^\]|]+)\]\]', lambda m: f'[{m.group(1)}](#{slug(m.group(1))})', text)

html = markdown.markdown(text, extensions=['fenced_code', 'toc', 'sane_lists'],
                         extension_configs={'toc': {'slugify': lambda s, sep: slug(s)}})
# every code block that is a prompt (Cyrillic inside) gets a copy button
html = re.sub(r'<pre><code>(.*?)</code></pre>',
              lambda m: f'<div class="prompt"><pre><code>{m.group(1)}</code></pre><button>Скопировать</button></div>',
              html, flags=re.S)

v = int(time.time())
OUT.write_text(f'''<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="Ставим ИИ-агента Hermes на дешевой модели, подключаем телегу и голос, делаем игры, плагины, ботов и выкладываем в интернет.">
<meta property="og:title" content="{title}">
<meta property="og:description" content="Hermes + DeepSeek: игры, плагины, боты и сайты без кода. Оплата картой РФ или Visa.">
<link rel="stylesheet" href="style.css?v={v}">
</head>
<body>
<main>
<header><p class="kicker">гайд для своих</p><h1>{title}</h1></header>
{html}
<footer><p class="small">Этот сайт собрал ИИ-агент из заметки в Обсидиане.</p></footer>
</main>
<script>
document.querySelectorAll('.prompt button').forEach(b => b.onclick = () =>
  navigator.clipboard.writeText(b.previousElementSibling.textContent).then(() => {{
    b.textContent = 'Скопировано'; setTimeout(() => b.textContent = 'Скопировать', 1500)
  }}))
</script>
</body>
</html>
''')
print('ok', OUT, len(html))
