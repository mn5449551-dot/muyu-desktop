const MUYU_TEXT_POOL = [
  '功德+1',
  '福气+1',
  '好运+1',
  '财运+1',
  '平安+1',
  '心想事成',
  '万事如意',
  '阿弥陀佛',
  '福至心灵',
  '吉祥如意',
  '诸事顺遂',
  '佛光普照',
]

const TEXT_POOL = [
  '哎哟！',
  '轻点！',
  '又来了～',
  '好烦啊！',
  '嗷！',
  '别戳了！',
  '疼！',
  '停下停下！',
  '我要生气了！',
  '烦死了！',
  '我警告你！',
  '再戳试试！',
  '呜呜呜～',
  '救命！',
  '不要！！',
  '咋这么欠揍呢',
  '我的小心肝儿～',
  '要！命！啦！',
  '╰（‵□′）╯',
]

export function getRandom(isMuyu) {
  const pool = isMuyu ? MUYU_TEXT_POOL : TEXT_POOL
  return pool[Math.floor(Math.random() * pool.length)]
}
