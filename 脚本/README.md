# 2000单词交付系统 · 脚本使用说明

## 环境准备

```bash
pip install -r requirements.txt
```

需要设置环境变量 `ANTHROPIC_API_KEY`（故事生产需要调用 Claude API）。

## 每周操作流程

### 1. 妈妈发来 Day7 数据

把妈妈发来的 Day7 数据整理成固定格式，保存到对应孩子的文件夹：

```
用户档案/孩子名_妈妈名/day7_待处理.md
```

文件格式：

```markdown
# Day 7 数据

**最终猜想：** （孩子的原话）

**还想看下一集吗：** （主动问了 / 愿意 / 无所谓 / 不想）
```

### 2. 查看待处理用户

```bash
python3 脚本/batch_run.py --dry-run
```

### 3. 批量生产

```bash
python3 脚本/batch_run.py
```

或只处理一个用户：

```bash
python3 脚本/batch_run.py --user 垚垚_焱佳
```

### 4. 检查输出

每个用户文件夹里会新增：
- 方案文件末尾追加了新一集内容
- `EpX_人物名.mp3` — 音频
- `孩子名_EpX_Day2英文原文阅读页.pdf` — PDF

### 5. 交给小助手发送

## 单独运行各脚本

```bash
# 只生成音频
python3 -c "import sys; sys.path.insert(0, '脚本'); from audio_generator import generate_audio; generate_audio('Hello world.', 'test.mp3')"

# 只生成 PDF
python3 -c "import sys; sys.path.insert(0, '脚本'); from pdf_generator import generate_reading_pdf; generate_reading_pdf('Hello world.', '测试', 1, 'test.pdf')"
```

## 运行测试

```bash
python3 -m pytest 脚本/tests/ -v
```
