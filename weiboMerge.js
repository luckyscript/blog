const qs = require('querystring');
const fs = require('node:fs');
const dayjs = require('dayjs');

const WEIBO_CONFIG = {
  value: 5351049607,
  containerid: 1076035351049607,
  name: 'luckyscript',
}

const WEIBO_OLD_CONFIG = {
  value: 1562002727,
  containerid: 1076031562002727,
  name: 'jsjhlk',
}



async function main(i) {

  const weiboFetchQuery = qs.stringify({
    type: "uid",
    value: WEIBO_OLD_CONFIG.value,
    containerid: WEIBO_OLD_CONFIG.containerid,
    page: i,
  });

  await fetch("https://m.weibo.cn/api/container/getIndex?" + weiboFetchQuery, {
    headers: {
      Accept: "application/json, text/plain, */*",
      "MWeibo-Pwa": "1",
      Referer: "https://m.weibo.cn/u/"+ WEIBO_OLD_CONFIG.value,
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      "X-Requested-With": "XMLHttpRequest",
    },
  })
  .then(res => res.json())
  .then(resDTO => resDTO.data?.cards || []).then(handleCards)
}

function handleCards(cards) {
  console.log(cards);
  cards.forEach(card => {
    const { mblog, scheme } = card;
    const { created_at, text, region_name } = mblog;
    const title = dayjs(created_at).format('YYYYMMDDHHMM');
    const fileName = title + '.md';

    const isExist = fs.existsSync('./test/' + fileName);
    if (isExist) {
      console.log('存在了');
      return;
    }
    fs.writeFileSync('./content/card/' + fileName, `---
title: card-${title}
date:  ${dayjs(created_at).format('YYYY-MM-DD HH:mm:ss')}
pos: ${region_name?.replace('发布于 ', '') || '火星'}
---
${text}

来源于个人weibo：[原文链接](${scheme})`);
  })
}

let i = 1;

while (i < 50) {

    main(i++);

}

