import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from batch_run import find_pending_users, mark_day7_done


def test_find_pending_users(tmp_path):
    # 创建两个用户目录，一个有 day7_待处理，一个没有
    user1 = tmp_path / "孩子A_妈妈A"
    user1.mkdir()
    (user1 / "孩子A_方案.md").write_text("# 方案")
    (user1 / "day7_待处理.md").write_text("# Day 7")

    user2 = tmp_path / "孩子B_妈妈B"
    user2.mkdir()
    (user2 / "孩子B_方案.md").write_text("# 方案")

    pending = find_pending_users(tmp_path)
    assert len(pending) == 1
    assert pending[0].name == "孩子A_妈妈A"


def test_mark_day7_done(tmp_path):
    day7_file = tmp_path / "day7_待处理.md"
    day7_file.write_text("# Day 7")

    mark_day7_done(tmp_path)

    assert not day7_file.exists()
    done_files = list(tmp_path.glob("day7_已处理_*.md"))
    assert len(done_files) == 1
