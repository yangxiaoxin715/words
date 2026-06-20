import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from story_producer import validate_story, StoryOutput


def _make_story_lines(word_count: int, dialogue_ratio: float) -> str:
    """生成测试用的故事文本。"""
    total_lines = 20
    dialogue_lines = int(total_lines * dialogue_ratio)
    non_dialogue_lines = total_lines - dialogue_lines

    words_per_line = word_count // total_lines
    lines = []
    for i in range(non_dialogue_lines):
        lines.append(" ".join(["word"] * words_per_line))
    for i in range(dialogue_lines):
        lines.append(f'"' + " ".join(["word"] * (words_per_line - 1)) + '," she said.')

    return "\n".join(lines)


def test_validate_word_count_too_low():
    output = StoryOutput(
        chinese_mother="中文故事",
        english_story="Short story.\nToo few words.",
        target_words=[{"word": f"w{i}"} for i in range(12)],
        quality_report={"word_count": 5, "dialogue_ratio": 0.8},
        ep_num=2,
    )
    plan = {"episodes": [{"target_words": ["a", "b", "c", "d", "e"]}]}
    errors = validate_story(output, plan)
    assert any("词数" in e for e in errors)


def test_validate_target_words_too_few():
    output = StoryOutput(
        chinese_mother="中文故事",
        english_story="A valid story. " * 15,
        target_words=[{"word": "w1"}],
        quality_report={"word_count": 150, "dialogue_ratio": 0.8},
        ep_num=1,
    )
    plan = {"episodes": []}
    errors = validate_story(output, plan)
    assert any("目标词" in e for e in errors)


def test_validate_pass():
    output = StoryOutput(
        chinese_mother="中文故事",
        english_story="A valid story. " * 40,  # 120 words, within 120-180 range
        target_words=[{"word": f"w{i}"} for i in range(12)],
        quality_report={"word_count": 150, "dialogue_ratio": 0.75},
        ep_num=1,
    )
    plan = {"episodes": []}
    errors = validate_story(output, plan)
    assert errors == []


def test_validate_ep2_reappear_too_few():
    output = StoryOutput(
        chinese_mother="中文故事",
        english_story="A story with compass only.",
        target_words=[{"word": f"w{i}"} for i in range(12)],
        quality_report={"word_count": 150, "dialogue_ratio": 0.75},
        ep_num=2,
    )
    plan = {
        "episodes": [
            {"target_words": ["compass", "ancient", "minor", "dare", "tavern",
                              "rough", "grin", "whispered", "ink", "coins", "offer", "officer"]}
        ]
    }
    errors = validate_story(output, plan)
    assert any("复现" in e for e in errors)
