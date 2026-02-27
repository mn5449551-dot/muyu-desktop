const CHARACTERS = [
  {
    id: 'muyu',
    name: '木鱼',
    idleImg: '/assets/images/muyu_idle.webp',
    hitImg: '/assets/images/muyu_hit.webp',
    mainAudio: '/assets/audio/muyu_main.mp3',
    rareAudioPool: [
      '/assets/audio/muyu_rare_1.mp3',
      '/assets/audio/muyu_rare_2.mp3',
      '/assets/audio/muyu_rare_3.mp3',
    ],
  },
  {
    id: 'hamster_orange',
    name: '橙色仓鼠',
    idleImg: '/assets/images/hamster_orange_idle.webp',
    hitImg: '/assets/images/hamster_orange_hit.webp',
    mainAudio: '/assets/audio/hamster_orange_main.mp3',
    rareAudio: '',
  },
  {
    id: 'hamster_gray',
    name: '灰色仓鼠',
    idleImg: '/assets/images/hamster_gray_idle.webp',
    hitImg: '/assets/images/hamster_gray_hit.webp',
    mainAudio: '/assets/audio/hamster_gray_main.mp3',
    rareAudio: '/assets/audio/hamster_gray_rare.mp3',
  },
  {
    id: 'frog',
    name: '青蛙',
    idleImg: '/assets/images/frog_idle.webp',
    hitImg: '/assets/images/frog_hit.webp',
    mainAudio: '/assets/audio/frog_main.mp3',
    rareAudio: '/assets/audio/frog_rare.mp3',
  },
  {
    id: 'capybara',
    name: '癞蛤蟆',
    idleImg: '/assets/images/capybara_idle.webp',
    hitImg: '/assets/images/capybara_hit.webp',
    mainAudio: '/assets/audio/capybara_main.mp3',
    rareAudio: '',
  },
  {
    id: 'qinglong',
    name: '青龙',
    idleImg: '/assets/images/qinglong_idle.webp',
    hitImg: '/assets/images/qinglong_hit.webp',
    mainAudio: '/assets/audio/qinglong_main.mp3',
    rareAudio: '',
  },
  {
    id: 'baihu',
    name: '白虎',
    idleImg: '/assets/images/baihu_idle.webp',
    hitImg: '/assets/images/baihu_hit.webp',
    mainAudio: '/assets/audio/baihu_main.mp3',
    rareAudio: '/assets/audio/baihu_rare.mp3',
  },
  {
    id: 'zhuque',
    name: '朱雀',
    idleImg: '/assets/images/zhuque_idle.webp',
    hitImg: '/assets/images/zhuque_hit.webp',
    mainAudio: '/assets/audio/zhuque_main.mp3',
    rareAudio: '',
  },
  {
    id: 'xuanwu',
    name: '玄武',
    idleImg: '/assets/images/xuanwu_idle.webp',
    hitImg: '/assets/images/xuanwu_hit.webp',
    mainAudio: '/assets/audio/xuanwu_main.mp3',
    rareAudio: '/assets/audio/xuanwu_rare.mp3',
  },
];

const UNLOCK_THRESHOLDS = {
  muyu: 0,
  hamster_orange: 0,
  hamster_gray: 500,
  frog: 1000,
  capybara: 0,
  qinglong: 0,
  baihu: 1500,
  zhuque: 0,
  xuanwu: 2000,
};

function findById(id) {
  return CHARACTERS.find(c => c.id === id) || CHARACTERS[0];
}

module.exports = { CHARACTERS, findById, UNLOCK_THRESHOLDS };
