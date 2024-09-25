const path = require('path');
const { glob } = require('glob')
const contentProcessors = require('../functions/contentProcessors');
const utils = require('./utils');
const pageHandler = require('./page');
const nodejieba = require('nodejieba');

let instance = null;
let stemmers = null;

function getLunr(config) {
  if (instance === null) {
    instance = require('lunr');
    require('lunr-languages/lunr.stemmer.support')(instance);
    require('lunr-languages/lunr.multi')(instance);
    require('lunr-languages/tinyseg')(instance);
    config.searchExtraLanguages.forEach((lang) =>
      require(`lunr-languages/lunr.${lang}`)(instance)
    );
  }
  return instance;
}
function getStemmers(config) {
  if (stemmers === null) {
    const languages = ['en'].concat(config.searchExtraLanguages);
    stemmers = getLunr(config).multiLanguage.apply(null, languages);
  }
  return stemmers;
}
function isEnglishOrNumber(text) {
  return /^[a-zA-Z0-9]+$/.test(text);
}
async function handler(query, config) {
  const contentDir = utils.normalizeDir(path.normalize(config.content_dir));
  // console.log(contentDir)
  const rawDocuments = await glob(`${contentDir}**/*.md`);
  // console.log(rawDocuments);
  const potentialDocuments = await Promise.all(
    rawDocuments.map((filePath) =>
      contentProcessors.extractDocument(contentDir, filePath, config.debug)
    )
  );
  const processDocumentContent = (content) => {
    const words = nodejieba.cut(content);
    // console.log(words);
    return words.join(' ');
  };
  // console.log(potentialDocuments); 全文
  const documents = potentialDocuments.filter((doc) => doc !== null);
  const lunrInstance = getLunr(config);
  // console.log(lunrInstance);
  const idx = lunrInstance(function () {
    this.use(getStemmers(config));
    // console.log(getStemmers(config));
    // this.use(lunrInstance.multiLanguage('en','zh'));
    this.field('title');
    this.field('body');
    this.ref('id');
    documents.forEach((doc) => {
      this.add({
        id: doc.id,
        title: processDocumentContent(doc.title),
        body: doc.body,
      });
    });
  });
  // 根据查询内容类型决定是否进行分词处理
  let processedQuery;
  if (isEnglishOrNumber(query)) {
    processedQuery = query;
  } else {
    const searchKeywords = nodejieba.cut(query);
    processedQuery = searchKeywords.join(' ');
  }
  console.log('['+processedQuery+']');

  // // 在 Lunr 索引中搜索处理后的关键词
  const results = idx.search(processedQuery);

  // 对每个搜索结果进行处理
  const searchResults = await Promise.all(
    results.map((result) =>
      processSearchResult(contentDir, config, query, result)
    )
  );
  return searchResults;
}

async function processSearchResult(contentDir, config, query, result) {
  const page = await pageHandler(contentDir + result.ref, config);
  page.excerpt = page.excerpt.replace(
    new RegExp(`(${query})`, 'gim'),
    '<span class="search-query">$1</span>'
  );

  return page;
}

exports.default = handler;
module.exports = exports.default;
