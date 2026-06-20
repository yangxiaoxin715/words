import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from mother_story_lib import add_to_library, search_library, load_index


def test_add_and_search(tmp_path):
    # 用 tmp_path 模拟母体库目录
    index_path = tmp_path / "索引表.md"
    index_path.write_text(
        "# 中文母体故事库 · 索引表\n\n"
        "| 人物 | 集数 | 标题 | 适用年级 | 已使用次数 | 文件路径 |\n"
        "|------|------|------|----------|-----------|----------|\n"
    )
    char_dir = tmp_path / "按人物"
    char_dir.mkdir()

    add_to_library(
        character="武则天",
        ep_num=1,
        title="为什么不改变女人地位",
        grade="初一",
        content="衎衎有一个神奇的历史罗盘...",
        library_dir=tmp_path,
    )

    # 验证文件已创建
    story_file = char_dir / "武则天" / "Ep1_为什么不改变女人地位.md"
    assert story_file.exists()

    # 验证索引已更新
    index = load_index(tmp_path)
    assert len(index) == 1
    assert index[0]["character"] == "武则天"

    # 搜索
    results = search_library("武则天", "女人地位", library_dir=tmp_path)
    assert len(results) >= 1
    assert "武则天" in results[0]["character"]


def test_search_no_match(tmp_path):
    index_path = tmp_path / "索引表.md"
    index_path.write_text(
        "# 中文母体故事库 · 索引表\n\n"
        "| 人物 | 集数 | 标题 | 适用年级 | 已使用次数 | 文件路径 |\n"
        "|------|------|------|----------|-----------|----------|\n"
    )
    (tmp_path / "按人物").mkdir()

    results = search_library("诸葛亮", "借东风", library_dir=tmp_path)
    assert results == []
