import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from pdf_generator import generate_reading_pdf


def test_generate_pdf_creates_file(tmp_path):
    story = "Line one of the story.\nLine two of the story.\nLine three."
    output = tmp_path / "test.pdf"
    result = generate_reading_pdf(story, "测试孩子", 1, output)
    assert result.exists()
    assert result.suffix == ".pdf"
    assert result.stat().st_size > 0


def test_generate_pdf_ep2(tmp_path):
    story = "The compass grew warm.\nGolden light flashed."
    output = tmp_path / "ep2.pdf"
    result = generate_reading_pdf(story, "垚垚", 2, output)
    assert result.exists()
