"""中文母体故事库管理：入库、搜索、索引维护。"""

import re
from pathlib import Path

from config import MOTHER_STORY_DIR


def load_index(library_dir: Path = None) -> list[dict]:
    """读取索引表，返回条目列表。"""
    lib = library_dir or MOTHER_STORY_DIR
    index_path = lib / "索引表.md"
    if not index_path.exists():
        return []

    entries = []
    text = index_path.read_text(encoding="utf-8")
    for line in text.split("\n"):
        if not line.startswith("|") or "---" in line:
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        # Skip header row (first cell is "人物")
        if len(cells) >= 6 and cells[0] and cells[0] != "人物":
            entries.append({
                "character": cells[0],
                "ep_num": cells[1],
                "title": cells[2],
                "grade": cells[3],
                "use_count": int(cells[4]) if cells[4].isdigit() else 0,
                "file_path": cells[5],
            })
    return entries


def search_library(
    character: str,
    question: str,
    library_dir: Path = None,
) -> list[dict]:
    """从母体库中搜索匹配的故事。先按人物精确匹配，再按标题关键词模糊匹配。"""
    entries = load_index(library_dir)

    # 按人物筛选
    character_matches = [e for e in entries if e["character"] == character]
    if not character_matches:
        return []

    # 如果有问题关键词，进一步筛选
    if question:
        keywords = re.findall(r"[\u4e00-\u9fff]+", question)
        scored = []
        for entry in character_matches:
            score = sum(1 for kw in keywords if kw in entry["title"])
            scored.append((score, entry))
        scored.sort(key=lambda x: -x[0])
        return [entry for score, entry in scored]

    return character_matches


def add_to_library(
    character: str,
    ep_num: int,
    title: str,
    grade: str,
    content: str,
    library_dir: Path = None,
):
    """将审核通过的中文母体入库。"""
    lib = library_dir or MOTHER_STORY_DIR

    # 创建人物目录
    char_dir = lib / "按人物" / character
    char_dir.mkdir(parents=True, exist_ok=True)

    # 写入故事文件
    filename = f"Ep{ep_num}_{title}.md"
    story_path = char_dir / filename
    story_path.write_text(content, encoding="utf-8")

    # 更新索引表
    relative_path = f"按人物/{character}/{filename}"
    index_path = lib / "索引表.md"
    with open(index_path, "a", encoding="utf-8") as f:
        f.write(f"| {character} | {ep_num} | {title} | {grade} | 0 | {relative_path} |\n")
