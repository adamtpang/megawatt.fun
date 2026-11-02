"""Build plug-and-play.html from docs/plug-and-play/*.md.

Each tool documents its own file format in one Markdown fragment. This turns
the fragments into one page. Supports the small Markdown subset the fragments
use: ## headings with {#id}, paragraphs, **bold**, `code`, [links](url),
pipe tables, fenced code blocks and - lists.

Run: python scripts/build-plug-docs.py
"""
import html
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
ORDER = ["market", "pitch", "supply", "finance", "launch"]


def inline(text):
    t = html.escape(text, quote=False)
    t = re.sub(r"`([^`]+)`", r"<code>\1</code>", t)
    t = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", t)
    t = re.sub(r"\[([^\]]+)\]\(([^)\s]+)\)", r'<a href="\2">\1</a>', t)
    return t


def md(src):
    out, para, lines = [], [], src.replace("\r\n", "\n").split("\n")
    i = 0

    def flush():
        if para:
            out.append("<p>" + inline(" ".join(para)) + "</p>")
            para.clear()

    while i < len(lines):
        line = lines[i]
        if line.startswith("```"):
            flush()
            j = i + 1
            while j < len(lines) and not lines[j].startswith("```"):
                j += 1
            out.append("<pre><code>" + html.escape("\n".join(lines[i + 1:j])) + "</code></pre>")
            i = j + 1
            continue
        m = re.match(r"^(#{2,3}) (.+?)(?: \{#([\w-]+)\})?$", line)
        if m:
            flush()
            level = len(m.group(1))
            anchor = f' id="{m.group(3)}"' if m.group(3) else ""
            out.append(f"<h{level}{anchor}>{inline(m.group(2))}</h{level}>")
        elif line.startswith("|"):
            flush()
            rows = []
            while i < len(lines) and lines[i].startswith("|"):
                cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                if not all(re.fullmatch(r":?-+:?", c) for c in cells):
                    rows.append(cells)
                i += 1
            head = "".join(f"<th scope=\"col\">{inline(c)}</th>" for c in rows[0])
            body = "".join("<tr>" + "".join(f"<td>{inline(c)}</td>" for c in r) + "</tr>" for r in rows[1:])
            out.append(f'<div class="pp-table"><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>')
            continue
        elif line.startswith("- "):
            flush()
            items = []
            while i < len(lines) and lines[i].startswith("- "):
                items.append("<li>" + inline(lines[i][2:]) + "</li>")
                i += 1
            out.append("<ul>" + "".join(items) + "</ul>")
            continue
        elif line.strip() == "":
            flush()
        else:
            para.append(line.strip())
        i += 1
    flush()
    return "\n".join(out)


def main():
    parts = []
    for name in ORDER:
        f = ROOT / "docs" / "plug-and-play" / f"{name}.md"
        if f.exists():
            parts.append(f'<section class="pp-card">\n{md(f.read_text(encoding="utf-8"))}\n</section>')
    tpl = (ROOT / "scripts" / "plug-and-play.template.html").read_text(encoding="utf-8")
    page = tpl.replace("<!-- SECTIONS -->", "\n".join(parts))
    assert "—" not in page, "em dash in docs"
    (ROOT / "plug-and-play.html").write_text(page, encoding="utf-8", newline="\n")
    print(f"plug-and-play.html: {len(parts)} tools")


if __name__ == "__main__":
    main()
