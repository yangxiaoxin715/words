"""音频生成：调 edge-tts 将英文故事转为 mp3。"""

import asyncio
from pathlib import Path

import edge_tts

from config import VOICE_NAME


def generate_audio(text: str, output_path: Path) -> Path:
    """将文本转为 mp3 音频文件。"""
    asyncio.run(_generate(text, output_path))
    return output_path


async def _generate(text: str, output_path: Path):
    communicate = edge_tts.Communicate(text, VOICE_NAME)
    await communicate.save(str(output_path))
