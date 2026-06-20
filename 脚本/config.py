from pathlib import Path

# 项目根目录
PROJECT_ROOT = Path(__file__).parent.parent

# 目录
USERS_DIR = PROJECT_ROOT / "用户档案"
MOTHER_STORY_DIR = PROJECT_ROOT / "中文母体库"
SCRIPTS_DIR = PROJECT_ROOT / "脚本"

# 音频
VOICE_NAME = "en-US-JennyNeural"

# 故事约束
WORD_COUNT_RANGE = (120, 180)
TARGET_WORD_COUNT_RANGE = (12, 15)
MIN_EP1_WORD_REAPPEAR = 5
MAX_WORDS_PER_SENTENCE = 12
MIN_DIALOGUE_RATIO = 0.70

# 文件标记
DAY7_PENDING_FILENAME = "day7_待处理.md"
DAY7_DONE_PREFIX = "day7_已处理_"
