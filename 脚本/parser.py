"""解析方案文件和 Day7 数据文件。

方案文件是 Markdown 格式，结构为：
- 基本信息（昵称、年级、人物兴趣等）
- 200词闯关结果
- Episode 1/2/3... 各集数据（英文故事、目标词表等）
"""

import re
from pathlib import Path


def parse_plan_file(path: Path) -> dict:
    """解析孩子的方案文件，返回结构化数据。"""
    text = path.read_text(encoding="utf-8")

    return {
        "basic_info": _parse_basic_info(text),
        "known_word_count": _parse_known_word_count(text),
        "unknown_words": _parse_unknown_words(text),
        "episodes": _parse_episodes(text),
    }


def parse_day7_data(path: Path) -> dict:
    """解析 Day7 待处理文件。"""
    text = path.read_text(encoding="utf-8")

    guess_match = re.search(r"\*\*最终猜想[：:]\*\*\s*(.+)", text)
    want_match = re.search(r"\*\*还想看下一集吗[：:]\*\*\s*(.+)", text)

    return {
        "final_guess": guess_match.group(1).strip() if guess_match else "",
        "want_next": want_match.group(1).strip() if want_match else "",
    }


def get_latest_episode(plan: dict) -> dict:
    """返回最新一集的数据。"""
    if not plan["episodes"]:
        return {}
    return plan["episodes"][-1]


def get_all_target_words(plan: dict) -> list[str]:
    """返回所有集的目标词合集。"""
    words = []
    for ep in plan["episodes"]:
        words.extend(ep["target_words"])
    return words


def _parse_basic_info(text: str) -> dict:
    """从基本信息区块提取字段。"""
    info = {}

    nickname_match = re.search(r"昵称[：:]\s*(\S+)", text)
    if nickname_match:
        name = nickname_match.group(1)
        # 去掉括号部分，如 "垚垚（妈妈：焱佳）" -> "垚垚"
        info["nickname"] = re.sub(r"[（(].*?[）)]", "", name)

    grade_match = re.search(r"年级[：:]\s*(.+)", text)
    if grade_match:
        info["grade"] = grade_match.group(1).strip()

    char_match = re.search(r"人物兴趣[：:]\s*(.+)", text)
    if char_match:
        info["character"] = char_match.group(1).strip()

    question_match = re.search(r"感兴趣的问题[：:]\s*(.+)", text)
    if question_match:
        info["question"] = question_match.group(1).strip()

    return info


def _parse_known_word_count(text: str) -> int:
    """提取已会词数量。"""
    match = re.search(r"[✓✔]\s*(\d+)\s*个\s*/\s*\d+\s*个", text)
    if match:
        return int(match.group(1))
    return 0


def _parse_unknown_words(text: str) -> list[str]:
    """提取不会的词列表。"""
    match = re.search(r"不会的\d+个词[：:]\s*(.+)", text)
    if not match:
        return []
    words_str = match.group(1).strip().rstrip(",，")
    return [w.strip() for w in re.split(r"[,，、\s]+", words_str) if w.strip()]


def _parse_episodes(text: str) -> list[dict]:
    """解析所有集数据。"""
    episodes = []

    # 按 "## Episode N:" 分割
    ep_blocks = re.split(r"(?=## Episode \d+)", text)

    for block in ep_blocks:
        ep_match = re.match(r"## Episode (\d+)[：:]\s*(.+)", block)
        if not ep_match:
            continue

        ep_num = int(ep_match.group(1))
        title = ep_match.group(2).strip()

        # 提取英文故事
        story = _extract_english_story(block)

        # 提取目标词
        target_words = _extract_target_words(block)

        episodes.append({
            "ep_num": ep_num,
            "title": title,
            "english_story": story,
            "target_words": target_words,
        })

    return episodes


def _extract_english_story(block: str) -> str:
    """从 Episode 块中提取英文故事文本。"""
    # 故事在 "### 英文故事" 和下一个 "###" 之间
    match = re.search(
        r"### 英文故事.*?\n\n(.+?)(?=\n###|\Z)",
        block,
        re.DOTALL,
    )
    if not match:
        return ""
    return match.group(1).strip()


def _extract_target_words(block: str) -> list[str]:
    """从目标词表中提取词列表。"""
    # 目标词在 Markdown 表格中，第一列是词
    words = []
    in_table = False
    for line in block.split("\n"):
        if "目标词表" in line:
            in_table = True
            continue
        if in_table and line.startswith("|"):
            # 跳过表头分隔行
            if "----" in line or "音标" in line or "词" == line.strip("|").split("|")[0].strip():
                continue
            cells = [c.strip() for c in line.strip("|").split("|")]
            if cells and cells[0] and not cells[0].startswith("-"):
                words.append(cells[0])
        elif in_table and not line.strip().startswith("|") and line.strip():
            # 表格结束
            if not line.strip().startswith("|"):
                in_table = False

    return words
