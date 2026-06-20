"""故事生产的 prompt 模板。"""

STORY_SYSTEM_PROMPT = """你是英语无痛自学导航系统的故事生产引擎。你的任务是根据孩子的数据，生成下一集英文故事。

## 你必须遵守的规则

1. 英文故事 120-180 词，逐句计数
2. 一句一行，每句不超过 12 个词
3. 对话占比 ≥ 70%
4. 目标新词 12-15 个，必须是孩子不认识的词（不在已会词表中）
5. Ep2+ 必须复现上集至少 5 个目标词
6. Ep2+ 开头从上集悬念切入，不重复介绍罗盘
7. 转场用 "Golden light flashed."
8. 每个目标词必须在故事上下文中可猜出意思
9. 结尾留悬念

## 输出格式

严格按以下 Markdown 格式输出，不要加任何多余内容：

### 中文故事母体

（中文故事原文）

### 英文故事

（英文故事，一句一行）

### 目标词表

| 词 | 音标 | 中文 | 在故事中怎么猜出意思 |
|----|------|------|---------------------|
（每个目标词一行）

### 质检数据

- 总词数：X
- 对话占比：X%
- 上集目标词复现：word1, word2, ...（共X个）
"""


def build_story_prompt(plan: dict, day7_data: dict, ep_num: int) -> str:
    """构建给 Claude 的用户 prompt。"""
    basic = plan["basic_info"]
    latest_ep = plan["episodes"][-1] if plan["episodes"] else None

    known_count = plan["known_word_count"]
    unknown_words = ", ".join(plan["unknown_words"])

    # 历史目标词（用于复现检查）
    all_target_words = []
    for ep in plan["episodes"]:
        all_target_words.extend(ep["target_words"])

    prompt = f"""## 孩子信息

- 昵称：{basic.get('nickname', '')}
- 年级：{basic.get('grade', '')}
- 感兴趣的历史人物：{basic.get('character', '')}
- 感兴趣的问题：{basic.get('question', '')}
- 已会词数量：{known_count}/100
- 不会的词：{unknown_words}

## 当前任务

生成 Episode {ep_num}。
"""

    if latest_ep and day7_data:
        prev_target = ", ".join(latest_ep["target_words"])
        prompt += f"""
## 上集数据

- 上集标题：{latest_ep.get('title', '')}
- 上集目标词（本集须复现 ≥5 个）：{prev_target}
- 孩子的 Day7 最终猜想：{day7_data['final_guess']}
- 还想看下一集吗：{day7_data['want_next']}

## 要求

1. 开头先回应孩子的猜想："{day7_data['final_guess']}"
2. 从上集悬念切入，不重复介绍罗盘
3. 上集目标词至少复现 5 个：{prev_target}
4. 新目标词 12-15 个，不能和以下已学目标词重复：{', '.join(all_target_words)}
"""
    else:
        prompt += """
## 要求

1. 这是第一集，用 Grandpa said 引入罗盘
2. 目标新词 12-15 个
"""

    return prompt
