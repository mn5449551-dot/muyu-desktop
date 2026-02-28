import { getRandom } from '../../utils/text-pool'

const MILESTONES = { 100: '整！', 500: '妙！', 1000: '牛！', 2333: '超神！', 9999: '封神！' }

const MILESTONE_DIALOGUES = {
  baihu:          { 100: '哦，一百下。算你还有点毅力。', 500: '五百了？你真的没事干吗……', 1000: '一千下！你是在拿我出气吗！', 2333: '两千三百三十三下，你在找什么？', 9999: '九千九百九十九……好，我认输了。' },
  muyu:           { 100: '功德一百，善。', 500: '五百下，心诚则灵。', 1000: '千下有余，施主慧根不浅。', 2333: '两千余下，无妄无念。', 9999: '近万下，功德圆满。' },
  hamster_orange: { 100: '哇！一百下耶！好厉害！', 500: '五百啦！你真的好喜欢戳我！', 1000: '一千下！天哪！你是在喜欢我吗！', 2333: '两千三百三十三！这个数字好奇怪啊！', 9999: '快一万了！！我的天！！！' },
  default:        { 100: '一百下了。', 500: '五百下。', 1000: '一千下了。', 2333: '两千余下。', 9999: '近万下了。' },
}

function getMilestoneDialogue(count, charId) {
  const map = MILESTONE_DIALOGUES[charId] || MILESTONE_DIALOGUES.default
  return map[count] || null
}
const MILESTONE_KEYS = Object.keys(MILESTONES).map(Number).sort((a, b) => a - b)
const PARTICLE_COLORS = ['#FF6B6B', '#FFD93D', '#6BCB77', '#4D96FF', '#FF9F1C', '#E040FB', '#00BCD4', '#FF5722']

function getTapHudText(count) {
  const milestoneText = MILESTONES[count]
  if (milestoneText) return `${count}次 · ${milestoneText}`

  const next = MILESTONE_KEYS.find((value) => value > count)
  if (next) return `${count}次 · 下个里程碑 ${next}`

  return `${count}次`
}

function shouldStartDragging(startPoint, nextPoint, thresholdPx) {
  const dx = Math.abs(Number(nextPoint?.x || 0) - Number(startPoint?.x || 0))
  const dy = Math.abs(Number(nextPoint?.y || 0) - Number(startPoint?.y || 0))
  return dx >= thresholdPx || dy >= thresholdPx
}

function resolveScaleHotkeyAction(event) {
  const key = String(event.key || '').toLowerCase()
  const code = String(event.code || '').toLowerCase()
  if (key === '+' || key === '=' || code === 'numpadadd') return 'grow'
  if (key === '-' || key === '_' || code === 'numpadsubtract') return 'shrink'
  if (key === '0' || code === 'digit0' || code === 'numpad0') return 'reset'
  return ''
}

function createFloatText({ count, charId, color, quadrant }) {
  const baseLeft = quadrant % 2 === 0 ? 8 : 42
  const baseTop = quadrant < 2 ? 12 : 38
  return {
    id: `ft_${count}_${Date.now()}`,
    text: getRandom(charId === 'muyu'),
    left: baseLeft + Math.random() * 30,
    top: baseTop + Math.random() * 22,
    color,
  }
}

function createHitParticles(count) {
  const particleCount = 5 + Math.floor(Math.random() * 4)
  return Array.from({ length: particleCount }, (_, i) => ({
    id: `p_${count}_${i}`,
    dir: i % 8,
    x: 44 + Math.random() * 12,
    y: 38 + Math.random() * 12,
    color: PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)],
    size: Math.round(8 + Math.random() * 10),
  }))
}

export {
  createFloatText,
  createHitParticles,
  getMilestoneDialogue,
  getTapHudText,
  resolveScaleHotkeyAction,
  shouldStartDragging,
}
