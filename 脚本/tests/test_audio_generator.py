import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from audio_generator import generate_audio


def test_generate_audio_creates_file(tmp_path):
    text = "Hello, this is a test story."
    output = tmp_path / "test.mp3"
    result = generate_audio(text, output)
    assert result.exists()
    assert result.suffix == ".mp3"
    assert result.stat().st_size > 0


def test_generate_audio_with_multiline(tmp_path):
    text = "Line one of the story.\nLine two of the story.\nLine three."
    output = tmp_path / "multiline.mp3"
    result = generate_audio(text, output)
    assert result.exists()
    assert result.stat().st_size > 0
