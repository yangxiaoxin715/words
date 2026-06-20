"""PDF 生成：将英文故事转为 Day2 原文阅读页 PDF。"""

from pathlib import Path

from weasyprint import HTML


TEMPLATE_PATH = Path(__file__).parent / "templates" / "reading_page.html"


def generate_reading_pdf(
    story_text: str,
    child_name: str,
    ep_num: int,
    output_path: Path,
) -> Path:
    """生成 Day2 原文阅读页 PDF。"""
    template = TEMPLATE_PATH.read_text(encoding="utf-8")

    # 每行故事变成一个 <p>
    lines = story_text.strip().split("\n")
    story_html = "\n".join(
        f'  <p class="story-line">{line.strip()}</p>' for line in lines if line.strip()
    )

    html_content = (
        template
        .replace("{{child_name}}", child_name)
        .replace("{{ep_num}}", str(ep_num))
        .replace("{{story_lines}}", story_html)
    )

    HTML(string=html_content).write_pdf(str(output_path))
    return output_path
