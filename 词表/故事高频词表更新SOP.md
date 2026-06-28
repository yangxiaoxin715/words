# 故事高频词表更新 SOP

## 目标

用已经写好的英文故事，反推 201-400 词中最值得保留和新增的词。词表服务故事理解，不按“更难”“更像教材”来选。

## 输入

- 已定稿或接近定稿的英文故事。
- 当前 `words-data.js`。
- 候选替换报告，建议放在 `词表/` 目录。

## 选词规则

1. 先统计故事中的词频和覆盖文件数。
2. 优先选影响理解的词：
   - 系列设定词，如 `compass`、`magic`。
   - 线索词，如 `ink`、`appear`、`page`、`line`。
   - 叙事动作和状态词，如 `stand`、`hold`、`fall`、`quiet`。
3. 人名、地名、历史专名、角色称呼不进词表。
4. 单篇故事里的情节词暂不进词表，除非它会成为系列核心词。
5. 不一次性重洗后 200。故事样本少于 30 篇时，建议每轮替换 30-50 个。

## 替换规则

1. 先保留后 200 中已经被故事高频使用的词。
2. 优先替换当前故事样本中几乎不用、且更像教材主题词的词。
3. 新增词来源标为 `故事高频`。
4. 后 200 的总数必须保持 200；全词表总数必须保持 400。
5. 事实性来源只维护在 `words-data.js`，测试只读取来源分布，不复制词表。

## 验证

每次更新后必须检查：

```bash
npm test
node -e "require('./words-data.js'); const words=globalThis.WORDS; const counts=words.slice(200).reduce((a,w)=>(a[w.source]=(a[w.source]||0)+1,a),{}); console.log({total:words.length, unique:new Set(words.map(w=>w.english.toLowerCase()+'|'+w.chinese)).size, counts});"
```

通过标准：

- `npm test` 全部通过。
- `total` 为 400。
- `unique` 为 400。
- `WORD_POOLS.foundation.length` 为 200。
- `WORD_POOLS.expansion.length` 为 200。

## 发布

如果线上页面由 GitHub Pages 提供，更新 `words-data.js` 后同步检查 `index.html` 的引用是否需要版本号：

```html
<script src="words-data.js?v=YYYYMMDD-topic"></script>
```

这样可以减少浏览器继续加载旧词表的概率。
