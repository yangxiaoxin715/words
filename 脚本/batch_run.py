"""批量调度主脚本：扫描所有用户，对有待处理 Day7 数据的用户生产下一集。

用法：
    python batch_run.py                    # 处理所有待处理用户
    python batch_run.py --dry-run          # 只列出待处理用户，不实际生产
    python batch_run.py --user 垚垚_焱佳   # 只处理指定用户
"""

import argparse
import datetime
from pathlib import Path

from config import USERS_DIR, DAY7_PENDING_FILENAME, DAY7_DONE_PREFIX
from parser import parse_plan_file
from story_producer import produce_story, validate_story, append_to_plan_file
from audio_generator import generate_audio
from pdf_generator import generate_reading_pdf


def find_pending_users(users_dir: Path) -> list[Path]:
    """找到所有有 day7_待处理.md 的用户文件夹。"""
    pending = []
    for user_dir in sorted(users_dir.iterdir()):
        if not user_dir.is_dir():
            continue
        if (user_dir / DAY7_PENDING_FILENAME).exists():
            pending.append(user_dir)
    return pending


def mark_day7_done(user_dir: Path):
    """将 day7_待处理.md 重命名为 day7_已处理_日期.md。"""
    day7_file = user_dir / DAY7_PENDING_FILENAME
    if day7_file.exists():
        today = datetime.date.today().isoformat()
        done_name = f"{DAY7_DONE_PREFIX}{today}.md"
        day7_file.rename(user_dir / done_name)


def _find_plan_file(user_dir: Path) -> Path:
    for f in user_dir.iterdir():
        if f.name.endswith("_方案.md"):
            return f
    raise FileNotFoundError(f"在 {user_dir} 中未找到方案文件")


def process_user(user_dir: Path) -> dict:
    """处理单个用户：生成故事 + 音频 + PDF。

    返回 {"status": "ok"|"error", "user": str, "message": str}
    """
    user_name = user_dir.name
    print(f"\n{'='*50}")
    print(f"处理用户：{user_name}")
    print(f"{'='*50}")

    try:
        # 1. 生成故事
        print("  → 生成故事...")
        output = produce_story(user_dir)

        # 2. 质检
        plan = parse_plan_file(_find_plan_file(user_dir))
        errors = validate_story(output, plan)
        if errors:
            print(f"  ✗ 质检未通过：")
            for e in errors:
                print(f"    - {e}")
            return {"status": "error", "user": user_name, "message": f"质检未通过: {errors}"}

        print(f"  ✓ 质检通过（{len(output.english_story.split())}词，{len(output.target_words)}个目标词）")

        # 3. 追加到方案文件
        append_to_plan_file(user_dir, output)
        print("  ✓ 已追加到方案文件")

        # 4. 生成音频
        child_name = plan["basic_info"].get("nickname", user_name.split("_")[0])
        character = plan["basic_info"].get("character", "story")
        audio_name = f"Ep{output.ep_num}_{character}.mp3"
        audio_path = user_dir / audio_name
        generate_audio(output.english_story, audio_path)
        print(f"  ✓ 音频已生成：{audio_name}")

        # 5. 生成 PDF
        pdf_name = f"{child_name}_Ep{output.ep_num}_Day2英文原文阅读页.pdf"
        pdf_path = user_dir / pdf_name
        generate_reading_pdf(output.english_story, child_name, output.ep_num, pdf_path)
        print(f"  ✓ PDF已生成：{pdf_name}")

        # 6. 标记 Day7 已处理
        mark_day7_done(user_dir)
        print("  ✓ Day7 已标记为已处理")

        return {"status": "ok", "user": user_name, "message": f"Ep{output.ep_num} 生成完毕"}

    except Exception as e:
        print(f"  ✗ 出错：{e}")
        return {"status": "error", "user": user_name, "message": str(e)}


def main():
    parser = argparse.ArgumentParser(description="2000单词交付系统 · 批量生产")
    parser.add_argument("--dry-run", action="store_true", help="只列出待处理用户")
    parser.add_argument("--user", type=str, help="只处理指定用户（文件夹名）")
    args = parser.parse_args()

    if args.user:
        user_dir = USERS_DIR / args.user
        if not user_dir.exists():
            print(f"用户文件夹不存在：{user_dir}")
            return
        pending = [user_dir] if (user_dir / DAY7_PENDING_FILENAME).exists() else []
    else:
        pending = find_pending_users(USERS_DIR)

    if not pending:
        print("没有待处理的用户。")
        return

    print(f"找到 {len(pending)} 个待处理用户：")
    for p in pending:
        print(f"  - {p.name}")

    if args.dry_run:
        return

    print(f"\n开始批量生产...")

    results = []
    for user_dir in pending:
        result = process_user(user_dir)
        results.append(result)

    # 汇总
    print(f"\n{'='*50}")
    print("批量生产完成")
    print(f"{'='*50}")
    ok = [r for r in results if r["status"] == "ok"]
    err = [r for r in results if r["status"] == "error"]
    print(f"成功：{len(ok)} 个")
    if err:
        print(f"失败：{len(err)} 个")
        for e in err:
            print(f"  - {e['user']}: {e['message']}")


if __name__ == "__main__":
    main()
