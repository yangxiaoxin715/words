function lookup({ type, text, context }) {
  const trimmedText = String(text || '').trim();
  const trimmedContext = String(context || '').trim();
  const isWord = type === 'word';

  return {
    meaning: isWord
      ? `先把 ${trimmedText} 放回句子里看，它通常是在补足动作、人物或场景。`
      : '这句话先看动作和人物关系，再结合前后句推意思。',
    keyWords: isWord ? [trimmedText] : trimmedText.split(/\s+/).slice(0, 5),
    contextClue: trimmedContext
      ? '结合你填的上下文，先找这句话前后出现过的人、物和动作。'
      : '先补一两句前后文，再判断它在故事里推动了什么。',
    relistenTip: isWord
      ? '重听时注意这个词前后的停顿和重音。'
      : '重听时先抓主语和动作词，不急着逐词翻译。',
  };
}

function generateDraft() {
  return {
    title: 'Next Story Draft',
    body: 'The learner opened the book again. New words appeared. A small key waited under the old map.',
    targetWords: [],
    reviewWords: [],
    reviewNotes: ['请人工检查故事钩子、用词难度和孩子猜想是否被接住。'],
  };
}

module.exports = { generateDraft, lookup };
