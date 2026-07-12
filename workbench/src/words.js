const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const config = require('./config');

function wordKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeWords(rawWords) {
  const seenKeys = new Map();

  return rawWords.map((word, index) => {
    const english = String(word.english || '').trim();
    const baseKey = wordKey(word.key || english) || `word-${index + 1}`;
    const seenCount = seenKeys.get(baseKey) || 0;
    seenKeys.set(baseKey, seenCount + 1);

    return {
      key: seenCount === 0 ? baseKey : `${baseKey}-${index + 1}`,
      english,
      chinese: String(word.chinese || '').trim(),
      position: Number(word.position) || index + 1,
      poolId: String(word.poolId || '').trim(),
      stageLabel: String(word.stageLabel || '').trim(),
      stageName: String(word.stageName || '').trim(),
      useStage: String(word.useStage || '').trim(),
      storyRole: String(word.storyRole || '').trim(),
      tags: Array.isArray(word.tags) ? word.tags.map(String) : [],
    };
  });
}

function loadWords() {
  const wordsPath = path.join(config.rootDir, 'words-data.js');
  const source = fs.readFileSync(wordsPath, 'utf8');
  const context = vm.createContext({});

  vm.runInContext(source, context, {
    filename: wordsPath,
    timeout: 1000,
  });

  if (!Array.isArray(context.WORDS)) {
    throw new Error('words-data.js did not define globalThis.WORDS');
  }

  return normalizeWords(context.WORDS);
}

const words = loadWords();
const wordsByKey = new Map(words.map((word) => [word.key, word]));

function getWords() {
  return words;
}

function findWord(key) {
  return wordsByKey.get(String(key || ''));
}

module.exports = {
  getWords,
  findWord,
  wordKey,
};
