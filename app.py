import csv
import io
import os
import re
import secrets
import hashlib
import sqlite3
import string
import urllib.request
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import quote

from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.requests import ClientDisconnect


ROOT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = ROOT_DIR.parent
PUBLIC_DIR = ROOT_DIR / "public"
WORDS_DATA_PATH = ROOT_DIR / "words-data.js"
LEGACY_WORDS_DATA_PATH = PROJECT_DIR / "words-data.js"
DEFAULT_DB_PATH = ROOT_DIR / "word_hunter.db"
DEFAULT_AUDIO_LIBRARY_PATH = ROOT_DIR / "audio-library"
DEFAULT_AUDIO_CACHE_PATH = ROOT_DIR / "audio-cache"
RESPONSES = {"known", "vague", "new"}
AUDIO_VOICES = {"us": "0", "uk": "1"}
LEVEL_LABELS = {1: "一级词", 2: "二级词", 3: "三级词"}
LEVEL_CODES = {"L1": 1, "L2": 2, "L3": 3}
NEW_FRIEND_COOLDOWN_COUNT = 2
EFFECTIVE_ELAPSED_CAP_MS = 10_000
STATUS_LABELS = {
    "new_friend": "新朋友",
    "familiar": "有点眼熟",
    "known": "老朋友",
    "stable": "老朋友",
}


class LearnerStart(BaseModel):
    learning_code: str = ""
    password: str = ""


class AdminLearnerIn(BaseModel):
    learning_code: str = ""
    password: str = ""
    display_name: str = ""


class AdminLearnerUpdate(BaseModel):
    display_name: str | None = None
    is_active: bool | None = None


class AdminPasswordReset(BaseModel):
    password: str = ""


class WordEventIn(BaseModel):
    word_id: int
    response: str = Field(pattern="^(known|vague|new)$")
    elapsed_ms: int = Field(default=0, ge=0)


class CustomPackIn(BaseModel):
    name: str = ""
    csv_text: str = ""


class CustomPackEventIn(BaseModel):
    pack_word_id: int
    response: str = Field(pattern="^(known|vague|new)$")
    elapsed_ms: int = Field(default=0, ge=0)


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def today_str() -> str:
    return date.today().isoformat()


def db_path() -> Path:
    return Path(os.environ.get("WORD_HUNTER_DB", str(DEFAULT_DB_PATH)))


def audio_library_path() -> Path:
    return Path(os.environ.get("WORD_HUNTER_AUDIO_LIBRARY", str(DEFAULT_AUDIO_LIBRARY_PATH)))


def audio_cache_path() -> Path:
    return Path(os.environ.get("WORD_HUNTER_AUDIO_CACHE", str(DEFAULT_AUDIO_CACHE_PATH)))


def connect() -> sqlite3.Connection:
    conn = sqlite3.connect(db_path())
    conn.row_factory = sqlite3.Row
    return conn


def normalize_learning_code(value: str) -> str:
    return value.strip().upper()


def random_password() -> str:
    alphabet = string.ascii_lowercase + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(8))


def hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    actual_salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        actual_salt.encode("utf-8"),
        120_000,
    ).hex()
    return actual_salt, digest


def verify_password(password: str, salt: str, expected_hash: str) -> bool:
    if not password or not salt or not expected_hash:
        return False
    _, actual_hash = hash_password(password, salt)
    return secrets.compare_digest(actual_hash, expected_hash)


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(conn: sqlite3.Connection, learner_id: int) -> str:
    token = secrets.token_urlsafe(32)
    stamp = now_iso()
    conn.execute(
        """
        insert into learner_sessions (learner_id, token_hash, created_at, last_seen_at)
        values (?, ?, ?, ?)
        """,
        (learner_id, hash_session_token(token), stamp, stamp),
    )
    return token


def create_learning_code(conn: sqlite3.Connection) -> str:
    rows = conn.execute("select learning_code from learners").fetchall()
    numeric_codes = [
        int(row["learning_code"])
        for row in rows
        if re.fullmatch(r"\d+", row["learning_code"])
    ]
    if numeric_codes:
        return f"{max(numeric_codes) + 1:05d}"
    return "00001"


def create_fallback_learning_code(conn: sqlite3.Connection) -> str:
    alphabet = string.ascii_uppercase + string.digits
    while True:
        code = "".join(secrets.choice(alphabet) for _ in range(6))
        exists = conn.execute(
            "select 1 from learners where learning_code = ?",
            (code,),
        ).fetchone()
        if not exists:
            return code


def ensure_column(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = {
        row["name"]
        for row in conn.execute(f"pragma table_info({table})").fetchall()
    }
    if column not in columns:
        conn.execute(f"alter table {table} add column {column} {definition}")


def require_admin(key: str) -> None:
    expected = os.environ.get("WORD_HUNTER_ADMIN_KEY", "dev-admin-key")
    if not secrets.compare_digest(key, expected):
        raise HTTPException(status_code=403, detail="无权限")


def chinese_number(value: int) -> str:
    names = {
        1: "一",
        2: "二",
        3: "三",
        4: "四",
        5: "五",
        6: "六",
        7: "七",
        8: "八",
        9: "九",
        10: "十",
    }
    if value in names:
        return names[value]
    if 10 < value < 20:
        return f"十{names[value - 10]}"
    return str(value)


def stage_label(stage_number: int) -> str:
    return LEVEL_LABELS.get(stage_number, f"第{chinese_number(stage_number)}级")


def stage_bounds_by_level(conn: sqlite3.Connection, stage_number: int) -> tuple[int, int, int]:
    """Return (start_position, end_position, target) for a level-based stage."""
    row = conn.execute(
        """
        select min(practice_position) as lo, max(practice_position) as hi, count(*) as cnt
        from words where level = ?
        """,
        (stage_number,),
    ).fetchone()
    if not row or row["cnt"] == 0:
        return 0, 0, 0
    return row["lo"], row["hi"], row["cnt"]


def parse_words() -> list[tuple[int, str, str, int]]:
    source = WORDS_DATA_PATH if WORDS_DATA_PATH.exists() else LEGACY_WORDS_DATA_PATH
    content = source.read_text(encoding="utf-8")
    entries = re.findall(r"\['([^']+)',\s*'([^']+)'(?:,\s*'([^']*)')?\]", content)
    result: list[tuple[int, str, str, int]] = []
    for index, (word, meaning, level_code) in enumerate(entries):
        level = LEVEL_CODES.get(level_code, 1)
        result.append((index + 1, word, meaning, level))
    return result


def mixed_practice_positions(total_words: int) -> dict[int, int]:
    if total_words <= 0:
        return {}

    band_size = (total_words + 2) // 3
    bands = [
        list(range(1, min(band_size, total_words) + 1)),
        list(range(band_size + 1, min(band_size * 2, total_words) + 1)),
        list(range(band_size * 2 + 1, total_words + 1)),
    ]
    order: list[int] = []
    max_len = max((len(band) for band in bands), default=0)
    for index in range(max_len):
        for band in bands:
            if index < len(band):
                order.append(band[index])
    return {
        original_position: practice_position
        for practice_position, original_position in enumerate(order, start=1)
    }


def parse_custom_pack_csv(csv_text: str) -> list[tuple[int, str, str]]:
    reader = csv.reader(io.StringIO(csv_text.replace("\ufeff", "")))
    rows: list[tuple[int, str, str]] = []
    seen: set[str] = set()
    for raw_index, row in enumerate(reader):
        if not row or all(not cell.strip() for cell in row):
            continue
        first = row[0].strip()
        second = row[1].strip() if len(row) > 1 else ""
        if raw_index == 0 and first.lower() in {"word", "单词"}:
            continue
        if not first or not second:
            continue
        key = first.lower()
        if key in seen:
            continue
        seen.add(key)
        rows.append((len(rows) + 1, first, second))
        if len(rows) > 100:
            raise HTTPException(status_code=422, detail="词包最多 100 个词")
    if not rows:
        raise HTTPException(status_code=422, detail="词包里没有可导入的单词")
    return rows


def decode_custom_pack_upload(raw: bytes) -> str:
    if not raw:
        raise HTTPException(status_code=422, detail="词包里没有可导入的单词")
    for encoding in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise HTTPException(status_code=422, detail="CSV 文件编码无法识别")


async def read_custom_pack_upload_csv(request: Request) -> str:
    content_type = request.headers.get("content-type", "").lower()
    if "multipart/form-data" in content_type:
        form = await request.form()
        upload = form.get("file")
        if upload is None:
            raise HTTPException(status_code=422, detail="请导入 CSV 文件")
        if hasattr(upload, "read"):
            try:
                raw = await upload.read()
            finally:
                if hasattr(upload, "close"):
                    await upload.close()
        else:
            raw = str(upload).encode("utf-8")
        return decode_custom_pack_upload(raw)
    return decode_custom_pack_upload(await request.body())


def audio_slug(word: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", word.strip().lower()).strip("-")
    return slug or "word"


def own_audio_candidates(word: str, voice: str) -> list[Path]:
    slug = audio_slug(word)
    base = audio_library_path()
    return [
        base / voice / f"{slug}.mp3",
        base / f"{slug}.mp3",
    ]


def cached_youdao_audio_path(word: str, voice: str) -> Path:
    return audio_cache_path() / "youdao" / voice / f"{audio_slug(word)}.mp3"


def fetch_youdao_audio(word: str, voice: str) -> bytes:
    youdao_type = AUDIO_VOICES[voice]
    url = f"https://dict.youdao.com/dictvoice?audio={quote(word)}&type={youdao_type}"
    request = urllib.request.Request(url, headers={"User-Agent": "WordHunter/0.1"})
    with urllib.request.urlopen(request, timeout=8) as response:
        content_type = response.headers.get("Content-Type", "")
        payload = response.read()
    if not payload or "audio" not in content_type:
        raise RuntimeError("invalid audio response")
    return payload


def audio_response(path: Path, source: str) -> FileResponse:
    return FileResponse(
        path,
        media_type="audio/mpeg",
        headers={"X-Word-Hunter-Audio-Source": source},
    )


def init_db() -> None:
    with connect() as conn:
        conn.executescript(
            """
            create table if not exists learners (
                id integer primary key autoincrement,
                learning_code text not null unique,
                password_hash text not null default '',
                password_salt text not null default '',
                display_name text not null default '',
                is_active integer not null default 1,
                current_stage integer not null default 1,
                created_at text not null
            );

            create table if not exists learner_sessions (
                id integer primary key autoincrement,
                learner_id integer not null,
                token_hash text not null unique,
                created_at text not null,
                last_seen_at text not null
            );

            create table if not exists words (
                id integer primary key autoincrement,
                position integer not null unique,
                practice_position integer,
                word text not null,
                meaning text not null
            );

            create table if not exists word_states (
                learner_id integer not null,
                word_id integer not null,
                status text not null,
                known_count integer not null default 0,
                seen_count integer not null default 0,
                last_response text not null default '',
                first_seen_at text not null,
                last_seen_at text not null,
                primary key (learner_id, word_id)
            );

            create table if not exists word_events (
                id integer primary key autoincrement,
                learner_id integer not null,
                word_id integer not null,
                response text not null,
                elapsed_ms integer not null default 0,
                created_at text not null
            );

            create table if not exists deck_rounds (
                id integer primary key autoincrement,
                learner_id integer not null,
                target_size integer not null,
                is_active integer not null default 1,
                created_at text not null,
                completed_at text not null default ''
            );

            create table if not exists deck_round_items (
                round_id integer not null,
                word_id integer not null,
                position integer not null,
                completed_at text not null default '',
                primary key (round_id, word_id)
            );

            create table if not exists custom_packs (
                id integer primary key autoincrement,
                learner_id integer not null,
                name text not null,
                is_active integer not null default 1,
                uploaded_at text not null
            );

            create table if not exists custom_pack_words (
                id integer primary key autoincrement,
                pack_id integer not null,
                position integer not null,
                word text not null,
                meaning text not null
            );

            create table if not exists custom_word_states (
                learner_id integer not null,
                custom_word_id integer not null,
                status text not null,
                known_count integer not null default 0,
                seen_count integer not null default 0,
                last_response text not null default '',
                first_seen_at text not null,
                last_seen_at text not null,
                primary key (learner_id, custom_word_id)
            );

            create table if not exists custom_word_events (
                id integer primary key autoincrement,
                learner_id integer not null,
                custom_word_id integer not null,
                response text not null,
                elapsed_ms integer not null default 0,
                created_at text not null
            );
            """
        )
        ensure_column(conn, "learners", "password_hash", "text not null default ''")
        ensure_column(conn, "learners", "password_salt", "text not null default ''")
        ensure_column(conn, "learners", "display_name", "text not null default ''")
        ensure_column(conn, "learners", "is_active", "integer not null default 1")
        ensure_column(conn, "learners", "current_stage", "integer not null default 1")
        ensure_column(conn, "words", "practice_position", "integer")
        ensure_column(conn, "words", "level", "integer not null default 1")
        words = parse_words()
        word_count = conn.execute("select count(*) from words").fetchone()[0]
        if word_count == 0:
            conn.executemany(
                "insert into words (position, word, meaning, level) values (?, ?, ?, ?)",
                words,
            )
            word_count = len(words)
        else:
            # Sync word list: match by word text to preserve IDs and learning data
            existing = {
                row["word"].lower(): row["id"]
                for row in conn.execute("select id, word from words").fetchall()
            }
            new_words = {w.lower() for _, w, _, _ in words}
            # Remove words no longer in the list
            removed = set(existing.keys()) - new_words
            if removed:
                for w in removed:
                    wid = existing[w]
                    conn.execute("delete from word_states where word_id = ?", (wid,))
                    conn.execute("delete from word_events where word_id = ?", (wid,))
                    conn.execute("delete from words where id = ?", (wid,))
            # Drop unique constraint temporarily by setting position to negative
            conn.execute("update words set position = -position")
            # Update existing, insert new
            for position, word, meaning, level in words:
                key = word.lower()
                if key in existing:
                    conn.execute(
                        "update words set position = ?, meaning = ?, level = ? where id = ?",
                        (position, meaning, level, existing[key]),
                    )
                else:
                    conn.execute(
                        "insert into words (position, word, meaning, level) values (?, ?, ?, ?)",
                        (position, word, meaning, level),
                    )
            word_count = len(words)
        if word_count:
            practice_positions = mixed_practice_positions(word_count)
            conn.executemany(
                "update words set practice_position = ? where position = ?",
                [
                    (practice_position, original_position)
                    for original_position, practice_position in practice_positions.items()
                ],
            )


def get_stage_capture(conn: sqlite3.Connection, learner_id: int) -> dict:
    learner = learner_or_404(conn, learner_id)
    stage_number = max(1, min(int(learner["current_stage"] or 1), 3))
    start, end, target = stage_bounds_by_level(conn, stage_number)
    captured = 0
    if target:
        captured = conn.execute(
            """
            select count(*)
            from word_states
            join words on words.id = word_states.word_id
            where word_states.learner_id = ?
              and word_states.status in ('known', 'stable')
              and words.level = ?
            """,
            (learner_id, stage_number),
        ).fetchone()[0]

    max_level = conn.execute("select max(level) from words").fetchone()[0] or 3
    next_stage_number = stage_number + 1 if stage_number < max_level else None
    return {
        "stage_number": stage_number,
        "label": stage_label(stage_number),
        "start_position": start,
        "end_position": end,
        "target": target,
        "captured": captured,
        "remaining": max(target - captured, 0),
        "complete": bool(target and captured >= target),
        "next_stage_number": next_stage_number,
        "next_stage_label": stage_label(next_stage_number) if next_stage_number else "",
    }


def get_dashboard(conn: sqlite3.Connection, learner_id: int) -> dict:
    states = conn.execute(
        "select status from word_states where learner_id = ?",
        (learner_id,),
    ).fetchall()
    status_counts: dict[str, int] = {}
    for row in states:
        status_counts[row["status"]] = status_counts.get(row["status"], 0) + 1

    today = today_str()
    core_today_seen = conn.execute(
        """
        select count(*)
        from word_events
        where learner_id = ? and created_at like ?
        """,
        (learner_id, f"{today}%"),
    ).fetchone()[0]
    custom_today_seen = conn.execute(
        """
        select count(*)
        from custom_word_events
        where learner_id = ? and created_at like ?
        """,
        (learner_id, f"{today}%"),
    ).fetchone()[0]
    core_seen_total = conn.execute(
        "select count(*) from word_events where learner_id = ?",
        (learner_id,),
    ).fetchone()[0]
    custom_seen_total = conn.execute(
        "select count(*) from custom_word_events where learner_id = ?",
        (learner_id,),
    ).fetchone()[0]
    core_today_elapsed_ms = conn.execute(
        """
        select coalesce(sum(
            case
                when elapsed_ms > ? then ?
                else elapsed_ms
            end
        ), 0)
        from word_events
        where learner_id = ? and created_at like ?
        """,
        (EFFECTIVE_ELAPSED_CAP_MS, EFFECTIVE_ELAPSED_CAP_MS, learner_id, f"{today}%"),
    ).fetchone()[0]
    custom_today_elapsed_ms = conn.execute(
        """
        select coalesce(sum(
            case
                when elapsed_ms > ? then ?
                else elapsed_ms
            end
        ), 0)
        from custom_word_events
        where learner_id = ? and created_at like ?
        """,
        (EFFECTIVE_ELAPSED_CAP_MS, EFFECTIVE_ELAPSED_CAP_MS, learner_id, f"{today}%"),
    ).fetchone()[0]
    today_seen = core_today_seen + custom_today_seen
    seen_total = core_seen_total + custom_seen_total
    today_elapsed_ms = core_today_elapsed_ms + custom_today_elapsed_ms

    today_new_known = conn.execute(
        """
        select count(distinct word_id) from word_events
        where learner_id = ? and created_at like ? and response = 'known'
        """,
        (learner_id, f"{today}%"),
    ).fetchone()[0]
    today_custom_known = conn.execute(
        """
        select count(distinct custom_word_id) from custom_word_events
        where learner_id = ? and created_at like ? and response = 'known'
        """,
        (learner_id, f"{today}%"),
    ).fetchone()[0]
    today_new = today_new_known + today_custom_known

    distinct_days = {
        row["day"]
        for row in conn.execute(
            """
            select distinct substr(created_at, 1, 10) as day
            from word_events
            where learner_id = ?
            union
            select distinct substr(created_at, 1, 10) as day
            from custom_word_events
            where learner_id = ?
            """,
            (learner_id, learner_id),
        ).fetchall()
    }
    streak = 0
    cursor = date.today()
    while cursor.isoformat() in distinct_days:
        streak += 1
        cursor -= timedelta(days=1)

    total_words = conn.execute("select count(*) from words").fetchone()[0]
    core_unique_seen_total = len(states)
    known_total = status_counts.get("known", 0) + status_counts.get("stable", 0)
    stable_total = status_counts.get("stable", 0)

    return {
        "today_seen": today_seen,
        "today_new": today_new,
        "daily_target": 100,
        "seen_total": seen_total,
        "core_today_seen": core_today_seen,
        "custom_today_seen": custom_today_seen,
        "today_elapsed_ms": today_elapsed_ms,
        "core_today_elapsed_ms": core_today_elapsed_ms,
        "custom_today_elapsed_ms": custom_today_elapsed_ms,
        "core_seen_total": core_seen_total,
        "custom_seen_total": custom_seen_total,
        "core_unique_seen_total": core_unique_seen_total,
        "known_total": known_total,
        "stable_total": stable_total,
        "familiar_total": status_counts.get("familiar", 0),
        "new_friend_total": status_counts.get("new_friend", 0),
        "streak_days": streak,
        "total_words": total_words,
        "seen_pct": round(core_unique_seen_total / total_words * 100, 1) if total_words else 0,
        "stage_capture": get_stage_capture(conn, learner_id),
    }


def learner_or_404(conn: sqlite3.Connection, learner_id: int) -> sqlite3.Row:
    learner = conn.execute(
        "select * from learners where id = ?",
        (learner_id,),
    ).fetchone()
    if not learner:
        raise HTTPException(status_code=404, detail="学习记录不存在")
    return learner


def learner_by_code_or_404(conn: sqlite3.Connection, learning_code: str) -> sqlite3.Row:
    learner = conn.execute(
        "select * from learners where learning_code = ?",
        (normalize_learning_code(learning_code),),
    ).fetchone()
    if not learner:
        raise HTTPException(status_code=404, detail="学习账号不存在")
    return learner


def require_session(
    conn: sqlite3.Connection,
    learner_id: int,
    session_token: str,
) -> sqlite3.Row:
    learner = learner_or_404(conn, learner_id)
    token_hash = hash_session_token(session_token)
    session = conn.execute(
        """
        select * from learner_sessions
        where learner_id = ? and token_hash = ?
        """,
        (learner_id, token_hash),
    ).fetchone()
    if not session:
        raise HTTPException(status_code=403, detail="请先登录")
    conn.execute(
        "update learner_sessions set last_seen_at = ? where id = ?",
        (now_iso(), session["id"]),
    )
    return learner


def card_from_row(row: sqlite3.Row) -> dict:
    return {
        "word_id": row["id"],
        "position": row["position"],
        "word": row["word"],
        "meaning": row["meaning"],
    }


def custom_card_from_row(row: sqlite3.Row) -> dict:
    return {
        "pack_word_id": row["id"],
        "position": row["position"],
        "word": row["word"],
        "meaning": row["meaning"],
    }


def learner_admin_row(conn: sqlite3.Connection, learner: sqlite3.Row) -> dict:
    dashboard = get_dashboard(conn, learner["id"])
    last_seen = conn.execute(
        """
        select max(created_at)
        from word_events
        where learner_id = ?
        """,
        (learner["id"],),
    ).fetchone()[0]
    event_count = conn.execute(
        "select count(*) from word_events where learner_id = ?",
        (learner["id"],),
    ).fetchone()[0]
    return {
        "learning_code": learner["learning_code"],
        "display_name": learner["display_name"],
        "is_active": bool(learner["is_active"]),
        "created_at": learner["created_at"],
        "last_seen_at": last_seen or "",
        "event_count": event_count,
        "today_seen": dashboard["today_seen"],
        "seen_total": dashboard["seen_total"],
        "known_total": dashboard["known_total"],
        "familiar_total": dashboard["familiar_total"],
        "new_friend_total": dashboard["new_friend_total"],
        "streak_days": dashboard["streak_days"],
    }


def active_custom_pack(conn: sqlite3.Connection, learner_id: int) -> sqlite3.Row | None:
    return conn.execute(
        """
        select *
        from custom_packs
        where learner_id = ? and is_active = 1
        order by id desc
        limit 1
        """,
        (learner_id,),
    ).fetchone()


def custom_pack_summary(conn: sqlite3.Connection, learner_id: int) -> dict | None:
    pack = active_custom_pack(conn, learner_id)
    if not pack:
        return None
    total = conn.execute(
        "select count(*) from custom_pack_words where pack_id = ?",
        (pack["id"],),
    ).fetchone()[0]
    captured = conn.execute(
        """
        select count(*)
        from custom_pack_words
        join custom_word_states
            on custom_word_states.custom_word_id = custom_pack_words.id
            and custom_word_states.learner_id = ?
        where custom_pack_words.pack_id = ?
          and custom_word_states.status in ('known', 'stable')
        """,
        (learner_id, pack["id"]),
    ).fetchone()[0]
    return {
        "pack_id": pack["id"],
        "name": pack["name"],
        "total": total,
        "captured": captured,
        "remaining": max(total - captured, 0),
        "complete": bool(total and captured >= total),
        "uploaded_at": pack["uploaded_at"],
    }


def custom_pack_deck_cards(
    conn: sqlite3.Connection,
    learner_id: int,
    limit: int,
) -> list[sqlite3.Row]:
    pack = active_custom_pack(conn, learner_id)
    if not pack:
        return []
    return conn.execute(
        """
        select custom_pack_words.*
        from custom_pack_words
        where custom_pack_words.pack_id = ?
        order by custom_pack_words.position
        limit ?
        """,
        (pack["id"], limit),
    ).fetchall()


def delete_custom_pack_data(conn: sqlite3.Connection, learner_id: int) -> None:
    word_rows = conn.execute(
        """
        select custom_pack_words.id
        from custom_pack_words
        join custom_packs on custom_packs.id = custom_pack_words.pack_id
        where custom_packs.learner_id = ?
        """,
        (learner_id,),
    ).fetchall()
    word_ids = [row["id"] for row in word_rows]
    if word_ids:
        placeholders = ",".join("?" for _ in word_ids)
        # 保留 custom_word_events（历史学习记录），只删状态
        conn.execute(
            f"delete from custom_word_states where learner_id = ? and custom_word_id in ({placeholders})",
            [learner_id, *word_ids],
        )
    conn.execute(
        """
        delete from custom_pack_words
        where pack_id in (select id from custom_packs where learner_id = ?)
        """,
        (learner_id,),
    )
    conn.execute("delete from custom_packs where learner_id = ?", (learner_id,))


def save_custom_pack(
    conn: sqlite3.Connection,
    learner_id: int,
    name: str,
    rows: list[tuple[int, str, str]],
) -> dict | None:
    delete_custom_pack_data(conn, learner_id)
    stamp = now_iso()
    pack_name = name.strip()[:40] or "导入词包"
    cursor = conn.execute(
        """
        insert into custom_packs (learner_id, name, is_active, uploaded_at)
        values (?, ?, 1, ?)
        """,
        (learner_id, pack_name, stamp),
    )
    pack_id = cursor.lastrowid
    conn.executemany(
        """
        insert into custom_pack_words (pack_id, position, word, meaning)
        values (?, ?, ?, ?)
        """,
        [(pack_id, position, word, meaning) for position, word, meaning in rows],
    )
    return custom_pack_summary(conn, learner_id)


def learner_word_rows(conn: sqlite3.Connection, learner_id: int) -> list[sqlite3.Row]:
    return conn.execute(
        """
        select
            words.id as word_id,
            words.position,
            words.word,
            words.meaning,
            word_states.status,
            word_states.known_count,
            word_states.seen_count,
            word_states.last_response,
            word_states.first_seen_at,
            word_states.last_seen_at
        from word_states
        join words on words.id = word_states.word_id
        where word_states.learner_id = ?
        order by words.position
        """,
        (learner_id,),
    ).fetchall()


def serialize_word_detail(row: sqlite3.Row) -> dict:
    return {
        "word_id": row["word_id"],
        "position": row["position"],
        "word": row["word"],
        "meaning": row["meaning"],
        "status": row["status"],
        "status_label": STATUS_LABELS.get(row["status"], row["status"]),
        "known_count": row["known_count"],
        "seen_count": row["seen_count"],
        "last_response": row["last_response"],
        "first_seen_at": row["first_seen_at"],
        "last_seen_at": row["last_seen_at"],
    }


def build_word_buckets(rows: list[sqlite3.Row]) -> dict:
    buckets = {
        "new_friend": [],
        "familiar": [],
        "known": [],
    }
    for row in rows:
        item = {
            "word": row["word"],
            "meaning": row["meaning"],
            "seen_count": row["seen_count"],
            "last_seen_at": row["last_seen_at"],
        }
        if row["status"] == "new_friend":
            buckets["new_friend"].append(item)
        elif row["status"] == "familiar":
            buckets["familiar"].append(item)
        elif row["status"] in {"known", "stable"}:
            buckets["known"].append(item)
    return buckets


def csv_cell(value) -> str:
    text = str(value or "")
    return f'"{text.replace(chr(34), chr(34) * 2)}"'


def learner_export_csv(learning_code: str, exported_at: str, rows: list[sqlite3.Row], custom_rows: list[sqlite3.Row] | None = None) -> str:
    bucket_order = [
        ("new_friend", "新朋友"),
        ("familiar", "有点眼熟"),
        ("known", "老朋友"),
        ("stable", "老朋友"),
    ]
    output_rows = [["学习编号", "导出时间", "来源", "词状态", "单词", "中文", "见过次数", "最后学习时间"]]
    for status, label in bucket_order:
        for row in rows:
            if row["status"] != status:
                continue
            output_rows.append(
                [
                    learning_code,
                    exported_at,
                    "核心词",
                    label,
                    row["word"],
                    row["meaning"],
                    row["seen_count"],
                    row["last_seen_at"],
                ]
            )
    if custom_rows:
        for status, label in bucket_order:
            for row in custom_rows:
                if row["status"] != status:
                    continue
                output_rows.append(
                    [
                        learning_code,
                        exported_at,
                        "导入词包",
                        label,
                        row["word"],
                        row["meaning"],
                        row["seen_count"],
                        row["last_seen_at"],
                    ]
                )
    return "\ufeff" + "\n".join(
        ",".join(csv_cell(cell) for cell in row)
        for row in output_rows
    )


def select_deck_cards(conn: sqlite3.Connection, learner_id: int, limit: int) -> list[sqlite3.Row]:
    stage = get_stage_capture(conn, learner_id)
    if stage["complete"] or not stage["target"]:
        return []

    return conn.execute(
        """
        select words.*
        from words
        left join word_states
            on word_states.word_id = words.id
            and word_states.learner_id = ?
        left join (
            select word_id, count(*) as new_count
            from word_events
            where learner_id = ?
              and response = 'new'
              and created_at >= ?
            group by word_id
        ) today_new_friend on today_new_friend.word_id = words.id
        where words.level = ?
          and (
              word_states.word_id is null
              or word_states.status not in ('known', 'stable')
          )
        order by
          case when coalesce(today_new_friend.new_count, 0) >= ? then 1 else 0 end,
          words.practice_position
        limit ?
        """,
        (
            learner_id,
            learner_id,
            today_str(),
            stage["stage_number"],
            NEW_FRIEND_COOLDOWN_COUNT,
            limit,
        ),
    ).fetchall()


def get_review_summary(conn: sqlite3.Connection, learner_id: int) -> dict:
    stage = get_stage_capture(conn, learner_id)
    if not stage["target"]:
        return {
            "remaining": 0,
            "familiar_total": 0,
            "new_friend_total": 0,
            "stage_capture": stage,
        }

    rows = conn.execute(
        """
        select word_states.status, count(*) as count
        from word_states
        join words on words.id = word_states.word_id
        where word_states.learner_id = ?
          and words.level = ?
          and word_states.status in ('new_friend', 'familiar')
        group by word_states.status
        """,
        (learner_id, stage["stage_number"]),
    ).fetchall()
    counts = {row["status"]: row["count"] for row in rows}
    familiar_total = counts.get("familiar", 0)
    new_friend_total = counts.get("new_friend", 0)
    return {
        "remaining": familiar_total + new_friend_total,
        "familiar_total": familiar_total,
        "new_friend_total": new_friend_total,
        "stage_capture": stage,
    }


def select_review_deck_cards(
    conn: sqlite3.Connection,
    learner_id: int,
    limit: int,
) -> list[sqlite3.Row]:
    stage = get_stage_capture(conn, learner_id)
    if stage["complete"] or not stage["target"]:
        return []

    return conn.execute(
        """
        select words.*
        from words
        join word_states
            on word_states.word_id = words.id
            and word_states.learner_id = ?
        where words.level = ?
          and word_states.status in ('new_friend', 'familiar')
        order by words.practice_position
        limit ?
        """,
        (learner_id, stage["stage_number"], limit),
    ).fetchall()


def active_round(conn: sqlite3.Connection, learner_id: int) -> sqlite3.Row | None:
    return conn.execute(
        """
        select *
        from deck_rounds
        where learner_id = ? and is_active = 1 and completed_at = ''
        order by id desc
        limit 1
        """,
        (learner_id,),
    ).fetchone()


def remaining_round_cards(conn: sqlite3.Connection, round_id: int) -> list[sqlite3.Row]:
    return conn.execute(
        """
        select words.*
        from deck_round_items
        join words on words.id = deck_round_items.word_id
        where deck_round_items.round_id = ?
          and deck_round_items.completed_at = ''
        order by deck_round_items.position
        """,
        (round_id,),
    ).fetchall()


def close_active_rounds(conn: sqlite3.Connection, learner_id: int) -> None:
    conn.execute(
        """
        update deck_rounds
        set is_active = 0
        where learner_id = ? and is_active = 1
        """,
        (learner_id,),
    )


def create_deck_round(
    conn: sqlite3.Connection,
    learner_id: int,
    limit: int,
) -> tuple[sqlite3.Row, list[sqlite3.Row]]:
    close_active_rounds(conn, learner_id)
    cards = select_deck_cards(conn, learner_id, limit)
    cursor = conn.execute(
        """
        insert into deck_rounds (learner_id, target_size, is_active, created_at)
        values (?, ?, 1, ?)
        """,
        (learner_id, limit, now_iso()),
    )
    round_id = cursor.lastrowid
    conn.executemany(
        """
        insert into deck_round_items (round_id, word_id, position)
        values (?, ?, ?)
        """,
        [
            (round_id, card["id"], index + 1)
            for index, card in enumerate(cards)
        ],
    )
    round_row = conn.execute(
        "select * from deck_rounds where id = ?",
        (round_id,),
    ).fetchone()
    return round_row, cards


def create_app() -> FastAPI:
    init_db()
    app = FastAPI(title="和单词交朋友", version="0.1.0")

    @app.get("/api/health")
    def health():
        return {"status": "ok"}

    @app.post("/api/learners")
    def start_learner(payload: LearnerStart):
        with connect() as conn:
            code = normalize_learning_code(payload.learning_code)
            if not code or not payload.password:
                raise HTTPException(status_code=401, detail="请输入学习编号和密码")
            learner = conn.execute(
                """
                select * from learners
                where learning_code = ? and is_active = 1
                """,
                (code,),
            ).fetchone()
            if not learner or not verify_password(
                payload.password,
                learner["password_salt"],
                learner["password_hash"],
            ):
                raise HTTPException(status_code=401, detail="学习编号或密码不正确")

            token = create_session(conn, learner["id"])
            return {
                "learner_id": learner["id"],
                "learning_code": learner["learning_code"],
                "session_token": token,
                "dashboard": get_dashboard(conn, learner["id"]),
            }

    @app.get("/api/learners/{learner_id}/dashboard")
    def dashboard(
        learner_id: int,
        x_word_hunter_session: str = Header(default=""),
    ):
        with connect() as conn:
            require_session(conn, learner_id, x_word_hunter_session)
            return get_dashboard(conn, learner_id)

    @app.get("/api/learners/{learner_id}/word-map")
    def word_map(
        learner_id: int,
        x_word_hunter_session: str = Header(default=""),
    ):
        with connect() as conn:
            require_session(conn, learner_id, x_word_hunter_session)
            rows = learner_word_rows(conn, learner_id)
            seen_words: set[str] = set()
            groups: dict[str, list[str]] = {"known": [], "new_friend": [], "familiar": []}
            for row in rows:
                status = row["status"]
                word = row["word"]
                seen_words.add(word.lower())
                if status in ("known", "stable"):
                    groups["known"].append(word)
                elif status == "familiar":
                    groups["familiar"].append(word)
                elif status == "new_friend":
                    groups["new_friend"].append(word)
            # Core word set for dedup
            core_words = {r["word"].lower() for r in conn.execute("select word from words").fetchall()}
            # Include custom pack words
            custom_rows = conn.execute(
                """
                select custom_pack_words.word, custom_word_states.status
                from custom_word_states
                join custom_pack_words on custom_pack_words.id = custom_word_states.custom_word_id
                where custom_word_states.learner_id = ?
                """,
                (learner_id,),
            ).fetchall()
            custom_groups: dict[str, list[str]] = {"known": [], "new_friend": [], "familiar": []}
            for row in custom_rows:
                word = row["word"]
                if word.lower() in seen_words:
                    continue
                seen_words.add(word.lower())
                status = row["status"]
                # If the word is in core 2000, put it in main groups; otherwise custom
                target = groups if word.lower() in core_words else custom_groups
                if status in ("known", "stable"):
                    target["known"].append(word)
                elif status == "familiar":
                    target["familiar"].append(word)
                elif status == "new_friend":
                    target["new_friend"].append(word)
            return {"core": groups, "custom": custom_groups}

    @app.get("/api/learners/{learner_id}/deck")
    def deck(
        learner_id: int,
        limit: int = Query(default=100, ge=1, le=100),
        reset: bool = Query(default=False),
        x_word_hunter_session: str = Header(default=""),
    ):
        with connect() as conn:
            require_session(conn, learner_id, x_word_hunter_session)
            current_round = None if reset else active_round(conn, learner_id)
            if current_round:
                cards = remaining_round_cards(conn, current_round["id"])
            else:
                current_round, cards = create_deck_round(conn, learner_id, limit)

            return {
                "cards": [card_from_row(row) for row in cards],
                "deck_summary": {
                    "round_id": current_round["id"],
                    "target_size": current_round["target_size"],
                    "remaining": len(cards),
                    "stage_capture": get_stage_capture(conn, learner_id),
                },
            }

    @app.get("/api/learners/{learner_id}/review-deck")
    def review_deck(
        learner_id: int,
        limit: int = Query(default=100, ge=1, le=100),
        x_word_hunter_session: str = Header(default=""),
    ):
        with connect() as conn:
            require_session(conn, learner_id, x_word_hunter_session)
            close_active_rounds(conn, learner_id)
            cards = select_review_deck_cards(conn, learner_id, limit)
            return {
                "cards": [card_from_row(row) for row in cards],
                "review_summary": get_review_summary(conn, learner_id),
            }

    @app.post("/api/learners/{learner_id}/stage/advance")
    def advance_stage(
        learner_id: int,
        x_word_hunter_session: str = Header(default=""),
    ):
        with connect() as conn:
            require_session(conn, learner_id, x_word_hunter_session)
            stage = get_stage_capture(conn, learner_id)
            if not stage["complete"]:
                raise HTTPException(status_code=409, detail="当前阶段还没有完成")
            if not stage["next_stage_number"]:
                raise HTTPException(status_code=409, detail="已经是最后一组")

            close_active_rounds(conn, learner_id)
            conn.execute(
                """
                update learners
                set current_stage = ?
                where id = ?
                """,
                (stage["next_stage_number"], learner_id),
            )
            dashboard = get_dashboard(conn, learner_id)
            return {
                "stage_capture": dashboard["stage_capture"],
                "dashboard": dashboard,
            }

    @app.post("/api/learners/{learner_id}/events")
    def record_event(
        learner_id: int,
        payload: WordEventIn,
        x_word_hunter_session: str = Header(default=""),
    ):
        if payload.response not in RESPONSES:
            raise HTTPException(status_code=422, detail="反馈类型不支持")

        with connect() as conn:
            require_session(conn, learner_id, x_word_hunter_session)
            word = conn.execute(
                "select * from words where id = ?",
                (payload.word_id,),
            ).fetchone()
            if not word:
                raise HTTPException(status_code=404, detail="单词不存在")

            existing = conn.execute(
                """
                select * from word_states
                where learner_id = ? and word_id = ?
                """,
                (learner_id, payload.word_id),
            ).fetchone()
            stamp = now_iso()

            known_count = existing["known_count"] if existing else 0
            if payload.response == "known":
                known_count += 1
                status = "stable" if known_count >= 3 else "known"
            elif payload.response == "vague":
                status = "familiar"
            else:
                known_count = 0
                status = "new_friend"

            if existing:
                conn.execute(
                    """
                    update word_states
                    set status = ?, known_count = ?, seen_count = seen_count + 1,
                        last_response = ?, last_seen_at = ?
                    where learner_id = ? and word_id = ?
                    """,
                    (
                        status,
                        known_count,
                        payload.response,
                        stamp,
                        learner_id,
                        payload.word_id,
                    ),
                )
            else:
                conn.execute(
                    """
                    insert into word_states (
                        learner_id, word_id, status, known_count, seen_count,
                        last_response, first_seen_at, last_seen_at
                    ) values (?, ?, ?, ?, 1, ?, ?, ?)
                    """,
                    (
                        learner_id,
                        payload.word_id,
                        status,
                        known_count,
                        payload.response,
                        stamp,
                        stamp,
                    ),
                )

            conn.execute(
                """
                insert into word_events (learner_id, word_id, response, elapsed_ms, created_at)
                values (?, ?, ?, ?, ?)
                """,
                (learner_id, payload.word_id, payload.response, payload.elapsed_ms, stamp),
            )
            current_round = active_round(conn, learner_id)
            if current_round:
                conn.execute(
                    """
                    update deck_round_items
                    set completed_at = ?
                    where round_id = ? and word_id = ? and completed_at = ''
                    """,
                    (stamp, current_round["id"], payload.word_id),
                )
                remaining = conn.execute(
                    """
                    select count(*)
                    from deck_round_items
                    where round_id = ? and completed_at = ''
                    """,
                    (current_round["id"],),
                ).fetchone()[0]
                if remaining == 0:
                    conn.execute(
                        """
                        update deck_rounds
                        set is_active = 0, completed_at = ?
                        where id = ?
                        """,
                        (stamp, current_round["id"]),
                    )

            return {
                "word_id": payload.word_id,
                "status": status,
                "dashboard": get_dashboard(conn, learner_id),
            }

    @app.get("/api/learners/{learner_id}/export")
    def export_learner_data(
        learner_id: int,
        x_word_hunter_session: str = Header(default=""),
    ):
        with connect() as conn:
            learner = require_session(conn, learner_id, x_word_hunter_session)
            rows = learner_word_rows(conn, learner_id)
            custom_rows = conn.execute(
                """
                select custom_pack_words.word, custom_pack_words.meaning,
                       custom_word_states.status, custom_word_states.seen_count,
                       custom_word_states.last_seen_at
                from custom_word_states
                join custom_pack_words on custom_pack_words.id = custom_word_states.custom_word_id
                where custom_word_states.learner_id = ?
                """,
                (learner_id,),
            ).fetchall()
            exported_at = now_iso()
            filename_date = exported_at[:10]
            filename = f"word-hunter-{learner['learning_code']}-{filename_date}.csv"
            return Response(
                content=learner_export_csv(learner["learning_code"], exported_at, rows, custom_rows),
                media_type="text/csv; charset=utf-8",
                headers={"Content-Disposition": f'attachment; filename="{filename}"'},
            )

    @app.get("/api/learners/{learner_id}/custom-pack")
    def get_custom_pack(
        learner_id: int,
        x_word_hunter_session: str = Header(default=""),
    ):
        with connect() as conn:
            require_session(conn, learner_id, x_word_hunter_session)
            return {"pack_summary": custom_pack_summary(conn, learner_id)}

    @app.post("/api/learners/{learner_id}/custom-pack")
    def import_custom_pack(
        learner_id: int,
        payload: CustomPackIn,
        x_word_hunter_session: str = Header(default=""),
    ):
        with connect() as conn:
            require_session(conn, learner_id, x_word_hunter_session)
            rows = parse_custom_pack_csv(payload.csv_text)
            return {"pack_summary": save_custom_pack(conn, learner_id, payload.name, rows)}

    @app.post("/api/learners/{learner_id}/custom-pack/upload")
    async def import_custom_pack_upload(
        learner_id: int,
        request: Request,
        name: str = Query(default="导入词包"),
        x_word_hunter_session: str = Header(default=""),
    ):
        try:
            csv_text = await read_custom_pack_upload_csv(request)
        except ClientDisconnect as exc:
            raise HTTPException(status_code=400, detail="文件上传中断，请重新选择 CSV") from exc
        with connect() as conn:
            require_session(conn, learner_id, x_word_hunter_session)
            rows = parse_custom_pack_csv(csv_text)
            return {"pack_summary": save_custom_pack(conn, learner_id, name, rows)}

    @app.get("/api/learners/{learner_id}/custom-pack/deck")
    def custom_pack_deck(
        learner_id: int,
        limit: int = Query(default=100, ge=1, le=100),
        x_word_hunter_session: str = Header(default=""),
    ):
        with connect() as conn:
            require_session(conn, learner_id, x_word_hunter_session)
            cards = custom_pack_deck_cards(conn, learner_id, limit)
            return {
                "cards": [custom_card_from_row(row) for row in cards],
                "pack_summary": custom_pack_summary(conn, learner_id),
            }

    @app.post("/api/learners/{learner_id}/custom-pack/events")
    def record_custom_pack_event(
        learner_id: int,
        payload: CustomPackEventIn,
        x_word_hunter_session: str = Header(default=""),
    ):
        if payload.response not in RESPONSES:
            raise HTTPException(status_code=422, detail="反馈类型不支持")

        with connect() as conn:
            require_session(conn, learner_id, x_word_hunter_session)
            pack = active_custom_pack(conn, learner_id)
            if not pack:
                raise HTTPException(status_code=404, detail="还没有导入词包")
            word = conn.execute(
                """
                select *
                from custom_pack_words
                where id = ? and pack_id = ?
                """,
                (payload.pack_word_id, pack["id"]),
            ).fetchone()
            if not word:
                raise HTTPException(status_code=404, detail="词包单词不存在")

            existing = conn.execute(
                """
                select * from custom_word_states
                where learner_id = ? and custom_word_id = ?
                """,
                (learner_id, payload.pack_word_id),
            ).fetchone()
            stamp = now_iso()
            known_count = existing["known_count"] if existing else 0
            if payload.response == "known":
                known_count += 1
                status = "stable" if known_count >= 3 else "known"
            elif payload.response == "vague":
                status = "familiar"
            else:
                known_count = 0
                status = "new_friend"

            if existing:
                conn.execute(
                    """
                    update custom_word_states
                    set status = ?, known_count = ?, seen_count = seen_count + 1,
                        last_response = ?, last_seen_at = ?
                    where learner_id = ? and custom_word_id = ?
                    """,
                    (
                        status,
                        known_count,
                        payload.response,
                        stamp,
                        learner_id,
                        payload.pack_word_id,
                    ),
                )
            else:
                conn.execute(
                    """
                    insert into custom_word_states (
                        learner_id, custom_word_id, status, known_count, seen_count,
                        last_response, first_seen_at, last_seen_at
                    ) values (?, ?, ?, ?, 1, ?, ?, ?)
                    """,
                    (
                        learner_id,
                        payload.pack_word_id,
                        status,
                        known_count,
                        payload.response,
                        stamp,
                        stamp,
                    ),
                )
            conn.execute(
                """
                insert into custom_word_events (
                    learner_id, custom_word_id, response, elapsed_ms, created_at
                ) values (?, ?, ?, ?, ?)
                """,
                (learner_id, payload.pack_word_id, payload.response, payload.elapsed_ms, stamp),
            )
            return {
                "pack_word_id": payload.pack_word_id,
                "status": status,
                "pack_summary": custom_pack_summary(conn, learner_id),
            }

    @app.get("/api/audio/speak")
    def speak_audio(word: str = Query(min_length=1, max_length=100), voice: str = Query(default="us", pattern="^(us|uk)$")):
        word_text = word.strip()
        if not word_text:
            raise HTTPException(status_code=422, detail="请提供单词")

        for candidate in own_audio_candidates(word_text, voice):
            if candidate.is_file():
                return audio_response(candidate, "library")

        cache_path = cached_youdao_audio_path(word_text, voice)
        if cache_path.is_file():
            return audio_response(cache_path, "cache")

        try:
            audio = fetch_youdao_audio(word_text, voice)
        except Exception as exc:
            raise HTTPException(status_code=503, detail="音频暂时不可用") from exc

        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_bytes(audio)
        return Response(
            content=audio,
            media_type="audio/mpeg",
            headers={"X-Word-Hunter-Audio-Source": "youdao"},
        )

    @app.get("/api/audio/{word_id}")
    def word_audio(word_id: int, voice: str = Query(default="us", pattern="^(us|uk)$")):
        with connect() as conn:
            word = conn.execute(
                "select * from words where id = ?",
                (word_id,),
            ).fetchone()
            if not word:
                raise HTTPException(status_code=404, detail="单词不存在")

        for candidate in own_audio_candidates(word["word"], voice):
            if candidate.is_file():
                return audio_response(candidate, "library")

        cache_path = cached_youdao_audio_path(word["word"], voice)
        if cache_path.is_file():
            return audio_response(cache_path, "cache")

        try:
            audio = fetch_youdao_audio(word["word"], voice)
        except Exception as exc:
            raise HTTPException(status_code=503, detail="音频暂时不可用") from exc

        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_bytes(audio)
        return Response(
            content=audio,
            media_type="audio/mpeg",
            headers={"X-Word-Hunter-Audio-Source": "youdao"},
        )

    @app.get("/api/admin/summary")
    def admin_summary(key: str = ""):
        require_admin(key)

        with connect() as conn:
            today = today_str()
            learner_count = conn.execute("select count(*) from learners").fetchone()[0]
            event_count = conn.execute("select count(*) from word_events").fetchone()[0]
            active_today = conn.execute(
                """
                select count(distinct learner_id)
                from word_events
                where created_at like ?
                """,
                (f"{today}%",),
            ).fetchone()[0]
            status_rows = conn.execute(
                """
                select status, count(*) as count
                from word_states
                group by status
                """
            ).fetchall()
            learners = conn.execute(
                """
                select *
                from learners
                order by learning_code
                """
            ).fetchall()
            return {
                "learner_count": learner_count,
                "event_count": event_count,
                "active_today": active_today,
                "status_counts": {row["status"]: row["count"] for row in status_rows},
                "learners": [learner_admin_row(conn, row) for row in learners],
            }

    @app.post("/api/admin/learners")
    def admin_create_learner(payload: AdminLearnerIn, key: str = ""):
        require_admin(key)
        with connect() as conn:
            code = normalize_learning_code(payload.learning_code) or create_learning_code(conn)
            if not re.fullmatch(r"[A-Z0-9]{3,20}", code):
                raise HTTPException(status_code=422, detail="学习编号只能使用 3-20 位字母或数字")
            exists = conn.execute(
                "select 1 from learners where learning_code = ?",
                (code,),
            ).fetchone()
            if exists:
                raise HTTPException(status_code=409, detail="这个学习编号已经存在")

            password = payload.password.strip() or random_password()
            if len(password) < 6:
                raise HTTPException(status_code=422, detail="密码至少 6 位")
            salt, password_hash = hash_password(password)
            conn.execute(
                """
                insert into learners (
                    learning_code, password_hash, password_salt, display_name,
                    is_active, created_at
                ) values (?, ?, ?, ?, 1, ?)
                """,
                (
                    code,
                    password_hash,
                    salt,
                    payload.display_name.strip(),
                    now_iso(),
                ),
            )
            return {
                "learning_code": code,
                "initial_password": password,
            }

    @app.patch("/api/admin/learners/{learning_code}")
    def admin_update_learner(
        learning_code: str,
        payload: AdminLearnerUpdate,
        key: str = "",
    ):
        require_admin(key)
        with connect() as conn:
            learner = learner_by_code_or_404(conn, learning_code)
            display_name = (
                learner["display_name"]
                if payload.display_name is None
                else payload.display_name.strip()
            )
            is_active = (
                learner["is_active"]
                if payload.is_active is None
                else 1 if payload.is_active else 0
            )
            conn.execute(
                """
                update learners
                set display_name = ?, is_active = ?
                where id = ?
                """,
                (display_name, is_active, learner["id"]),
            )
            if not is_active:
                conn.execute(
                    "delete from learner_sessions where learner_id = ?",
                    (learner["id"],),
                )
            updated = learner_by_code_or_404(conn, learning_code)
            return {
                "learning_code": updated["learning_code"],
                "display_name": updated["display_name"],
                "is_active": bool(updated["is_active"]),
            }

    @app.post("/api/admin/learners/{learning_code}/password")
    def admin_reset_password(
        learning_code: str,
        payload: AdminPasswordReset,
        key: str = "",
    ):
        require_admin(key)
        with connect() as conn:
            learner = learner_by_code_or_404(conn, learning_code)
            password = payload.password.strip() or random_password()
            if len(password) < 6:
                raise HTTPException(status_code=422, detail="密码至少 6 位")
            salt, password_hash = hash_password(password)
            conn.execute(
                """
                update learners
                set password_hash = ?, password_salt = ?
                where id = ?
                """,
                (password_hash, salt, learner["id"]),
            )
            conn.execute(
                "delete from learner_sessions where learner_id = ?",
                (learner["id"],),
            )
            return {
                "learning_code": learner["learning_code"],
                "initial_password": password,
            }

    @app.delete("/api/admin/learners/{learning_code}")
    def admin_delete_learner(learning_code: str, key: str = ""):
        require_admin(key)
        with connect() as conn:
            learner = learner_by_code_or_404(conn, learning_code)
            delete_custom_pack_data(conn, learner["id"])
            conn.execute(
                "delete from learner_sessions where learner_id = ?",
                (learner["id"],),
            )
            conn.execute(
                "delete from word_events where learner_id = ?",
                (learner["id"],),
            )
            conn.execute(
                "delete from word_states where learner_id = ?",
                (learner["id"],),
            )
            conn.execute(
                "delete from learners where id = ?",
                (learner["id"],),
            )
            return {
                "learning_code": learner["learning_code"],
                "deleted": True,
            }

    @app.get("/api/admin/learners/{learning_code}/words")
    def admin_learner_words(learning_code: str, key: str = ""):
        require_admin(key)
        with connect() as conn:
            learner = learner_by_code_or_404(conn, learning_code)
            return {
                "learner": learner_admin_row(conn, learner),
                "words": [
                    serialize_word_detail(row)
                    for row in learner_word_rows(conn, learner["id"])
                ],
            }

    @app.get("/api/admin/learners/{learning_code}/export")
    def admin_export_learner(learning_code: str, key: str = ""):
        require_admin(key)
        with connect() as conn:
            learner = learner_by_code_or_404(conn, learning_code)
            rows = learner_word_rows(conn, learner["id"])
            return {
                "learning_code": learner["learning_code"],
                "display_name": learner["display_name"],
                "dashboard": get_dashboard(conn, learner["id"]),
                "word_buckets": build_word_buckets(rows),
            }

    if PUBLIC_DIR.exists():
        app.mount("/", StaticFiles(directory=str(PUBLIC_DIR), html=True), name="public")

    return app


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=int(os.environ.get("PORT", "8000")))
