import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from parser import parse_plan_file, parse_day7_data, get_latest_episode, get_all_target_words

FIXTURES = Path(__file__).parent / "fixtures"


def test_parse_plan_file_basic_info():
    plan = parse_plan_file(FIXTURES / "测试孩子_方案.md")
    assert plan["basic_info"]["nickname"] == "测试孩子"
    assert plan["basic_info"]["grade"] == "六年级"
    assert plan["basic_info"]["character"] == "刘邦"


def test_parse_plan_file_words():
    plan = parse_plan_file(FIXTURES / "测试孩子_方案.md")
    assert len(plan["unknown_words"]) == 10
    assert "forest" in plan["unknown_words"]
    assert plan["known_word_count"] == 90


def test_parse_plan_file_episodes():
    plan = parse_plan_file(FIXTURES / "测试孩子_方案.md")
    assert len(plan["episodes"]) == 1
    ep = plan["episodes"][0]
    assert ep["ep_num"] == 1
    assert "compass" in ep["english_story"]
    assert len(ep["target_words"]) == 12
    assert "compass" in ep["target_words"]


def test_get_latest_episode():
    plan = parse_plan_file(FIXTURES / "测试孩子_方案.md")
    ep = get_latest_episode(plan)
    assert ep["ep_num"] == 1


def test_get_all_target_words():
    plan = parse_plan_file(FIXTURES / "测试孩子_方案.md")
    words = get_all_target_words(plan)
    assert "compass" in words
    assert "ink" in words
    assert len(words) == 12


def test_parse_day7_data():
    data = parse_day7_data(FIXTURES / "day7_待处理.md")
    assert "吕公" in data["final_guess"]
    assert data["want_next"] == "主动问了"
