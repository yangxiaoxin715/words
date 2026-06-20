"""集成测试：验证从方案文件解析到音频+PDF生成的完整链路。

注意：不测 Claude API 调用（那是 story_producer 的职责），只测其余链路。
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from parser import parse_plan_file, parse_day7_data
from story_producer import StoryOutput, validate_story, append_to_plan_file
from audio_generator import generate_audio
from pdf_generator import generate_reading_pdf
from batch_run import find_pending_users, mark_day7_done

FIXTURES = Path(__file__).parent / "fixtures"


def test_full_pipeline_without_api(tmp_path):
    """模拟完整流程（跳过 API 调用）：解析 → 质检 → 追加 → 音频 → PDF。"""

    # 准备用户目录
    user_dir = tmp_path / "测试孩子_测试妈妈"
    user_dir.mkdir()

    # 拷贝 fixture 方案文件
    plan_src = FIXTURES / "测试孩子_方案.md"
    plan_dst = user_dir / "测试孩子_方案.md"
    plan_dst.write_text(plan_src.read_text(encoding="utf-8"), encoding="utf-8")

    # 拷贝 Day7 数据
    day7_src = FIXTURES / "day7_待处理.md"
    day7_dst = user_dir / "day7_待处理.md"
    day7_dst.write_text(day7_src.read_text(encoding="utf-8"), encoding="utf-8")

    # 1. 解析
    plan = parse_plan_file(plan_dst)
    assert plan["basic_info"]["nickname"] == "测试孩子"
    assert len(plan["episodes"]) == 1

    day7 = parse_day7_data(day7_dst)
    assert "吕公" in day7["final_guess"]

    # 2. 模拟 AI 输出
    mock_story = (
        "The compass grew warm in her hand.\n"
        '"We need to find the answer," she said.\n'
        '"Look at this ancient scroll," the old man whispered.\n'
        '"What does it say?" she asked.\n'
        '"It says the coins are hidden," he replied.\n'
        '"Where?" she asked.\n'
        '"In the tavern," he said with a grin.\n'
        '"The rough stones mark the spot," he added.\n'
        '"I dare not go alone," she said.\n'
        '"You must be brave," the officer told her.\n'
        '"I will offer my help," the minor guard said.\n'
        '"Then let us go," she said.\n'
        "They walked through the golden light together.\n"
        "The ink on the old map began to glow bright.\n"
        '"This is the place," she whispered with a smile.\n'
        "She looked at the rough wall and felt the cold stone.\n"
        '"Do you dare to open it?" the officer asked.\n'
        '"Yes," she said. "I dare."\n'
        "She pushed the door open wide.\n"
        "Inside, she found an ancient chest full of old coins.\n"
    )

    output = StoryOutput(
        chinese_mother="测试中文母体故事",
        english_story=mock_story,
        target_words=[{"word": f"word{i}", "phonetic": "", "chinese": "", "hint": ""} for i in range(12)],
        quality_report={"word_count": 150, "dialogue_ratio": 0.75},
        ep_num=2,
    )

    # 3. 质检（mock 故事包含了上集复现词）
    errors = validate_story(output, plan)
    # mock 故事包含 compass, ancient, coins, tavern, grin, rough, dare, officer, offer, whispered, ink
    assert errors == [], f"质检错误: {errors}"

    # 4. 追加到方案文件
    append_to_plan_file(user_dir, output)
    updated_plan = parse_plan_file(plan_dst)
    assert len(updated_plan["episodes"]) == 2

    # 5. 生成音频
    audio_path = user_dir / "Ep2_test.mp3"
    generate_audio(output.english_story, audio_path)
    assert audio_path.exists()
    assert audio_path.stat().st_size > 0

    # 6. 生成 PDF
    pdf_path = user_dir / "测试孩子_Ep2_Day2英文原文阅读页.pdf"
    generate_reading_pdf(output.english_story, "测试孩子", 2, pdf_path)
    assert pdf_path.exists()

    # 7. 标记 Day7 已处理
    mark_day7_done(user_dir)
    assert not day7_dst.exists()
    assert len(list(user_dir.glob("day7_已处理_*.md"))) == 1
