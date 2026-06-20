"""故事生产脚本：调 Claude API 生成英文故事 + 质检。"""

import re
import os
from dataclasses import dataclass, field
from pathlib import Path

from anthropic import Anthropic

from config import (
    WORD_COUNT_RANGE,
    TARGET_WORD_COUNT_RANGE,
    MIN_EP1_WORD_REAPPEAR,
)
from parser import parse_plan_file, parse_day7_data, get_latest_episode
from prompts import STORY_SYSTEM_PROMPT, build_story_prompt


@dataclass
class StoryOutput:
    chinese_mother: str
    english_story: str
    target_words: list[dict]
    quality_report: dict
    ep_num: int


def produce_story(user_dir: Path) -> StoryOutput:
    """读取用户数据，调 Claude 生成下一集故事。"""
    plan_file = _find_plan_file(user_dir)
    plan = parse_plan_file(plan_file)

    day7_file = user_dir / "day7_待处理.md"
    day7_data = parse_day7_data(day7_file) if day7_file.exists() else None

    ep_num = len(plan["episodes"]) + 1

    user_prompt = build_story_prompt(plan, day7_data, ep_num)

    client = Anthropic()
    response = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=4096,
        system=STORY_SYSTEM_PROMPT,
        messages=[{"role": "user", "content": user_prompt}],
    )

    raw_output = response.content[0].text
    return _parse_claude_output(raw_output, ep_num)


def validate_story(output: StoryOutput, plan: dict) -> list[str]:
    """质检故事输出，返回问题列表。空列表 = 通过。"""
    errors = []

    # 词数检查
    word_count = len(output.english_story.split())
    if word_count < WORD_COUNT_RANGE[0]:
        errors.append(f"词数不足：{word_count} < {WORD_COUNT_RANGE[0]}")
    if word_count > WORD_COUNT_RANGE[1]:
        errors.append(f"词数超标：{word_count} > {WORD_COUNT_RANGE[1]}")

    # 目标词数量检查
    target_count = len(output.target_words)
    if target_count < TARGET_WORD_COUNT_RANGE[0]:
        errors.append(f"目标词不足：{target_count} < {TARGET_WORD_COUNT_RANGE[0]}")
    if target_count > TARGET_WORD_COUNT_RANGE[1]:
        errors.append(f"目标词过多：{target_count} > {TARGET_WORD_COUNT_RANGE[1]}")

    # Ep2+ 复现检查
    if output.ep_num >= 2 and plan["episodes"]:
        prev_target_words = plan["episodes"][-1]["target_words"]
        story_lower = output.english_story.lower()
        reappeared = [w for w in prev_target_words if w.lower() in story_lower]
        if len(reappeared) < MIN_EP1_WORD_REAPPEAR:
            errors.append(
                f"上集目标词复现不足：{len(reappeared)} < {MIN_EP1_WORD_REAPPEAR}，"
                f"复现了 {reappeared}"
            )

    return errors


def append_to_plan_file(user_dir: Path, output: StoryOutput):
    """将新一集内容追加到方案文件末尾。"""
    plan_file = _find_plan_file(user_dir)
    content = f"""

---

## Episode {output.ep_num}: (AI 生成)

### 中文故事母体

{output.chinese_mother}

### 英文故事

{output.english_story}

### 目标词表

| 词 | 音标 | 中文 | 在故事中怎么猜出意思 |
|----|------|------|---------------------|
"""
    for tw in output.target_words:
        word = tw.get("word", "")
        phonetic = tw.get("phonetic", "")
        chinese = tw.get("chinese", "")
        hint = tw.get("hint", "")
        content += f"| {word} | {phonetic} | {chinese} | {hint} |\n"

    with open(plan_file, "a", encoding="utf-8") as f:
        f.write(content)


def _find_plan_file(user_dir: Path) -> Path:
    """在用户文件夹中找到方案文件。"""
    for f in user_dir.iterdir():
        if f.name.endswith("_方案.md"):
            return f
    raise FileNotFoundError(f"在 {user_dir} 中未找到方案文件（*_方案.md）")


def _parse_claude_output(raw: str, ep_num: int) -> StoryOutput:
    """解析 Claude 返回的 Markdown 结构。"""
    # 提取中文母体
    chinese_match = re.search(
        r"### 中文故事母体\s*\n\n(.+?)(?=\n###)", raw, re.DOTALL
    )
    chinese_mother = chinese_match.group(1).strip() if chinese_match else ""

    # 提取英文故事
    english_match = re.search(
        r"### 英文故事\s*\n\n(.+?)(?=\n###)", raw, re.DOTALL
    )
    english_story = english_match.group(1).strip() if english_match else ""

    # 提取目标词表
    target_words = []
    table_match = re.search(
        r"### 目标词表.*?\n\|.*?\n\|[-\s|]+\n(.+?)(?=\n###|\Z)", raw, re.DOTALL
    )
    if table_match:
        for line in table_match.group(1).strip().split("\n"):
            if line.startswith("|"):
                cells = [c.strip() for c in line.strip("|").split("|")]
                if len(cells) >= 4:
                    target_words.append({
                        "word": cells[0],
                        "phonetic": cells[1],
                        "chinese": cells[2],
                        "hint": cells[3],
                    })

    # 提取质检数据
    quality_report = {}
    wc_match = re.search(r"总词数[：:]\s*(\d+)", raw)
    if wc_match:
        quality_report["word_count"] = int(wc_match.group(1))
    dr_match = re.search(r"对话占比[：:]\s*(\d+)", raw)
    if dr_match:
        quality_report["dialogue_ratio"] = int(dr_match.group(1)) / 100

    return StoryOutput(
        chinese_mother=chinese_mother,
        english_story=english_story,
        target_words=target_words,
        quality_report=quality_report,
        ep_num=ep_num,
    )
