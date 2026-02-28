'use strict'

function daysDiff(tsA, tsB) {
  const left = Number(tsA)
  const right = Number(tsB)
  if (!Number.isFinite(left) || !Number.isFinite(right)) return 0
  return Math.floor(Math.abs(left - right) / 86400000)
}

function toLocalMMDD(ts) {
  const d = new Date(Number(ts) || Date.now())
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${mm}-${dd}`
}

function toLocalDateStr(ts) {
  return new Date(Number(ts) || Date.now()).toLocaleDateString('zh-CN')
}

module.exports = {
  daysDiff,
  toLocalMMDD,
  toLocalDateStr,
}
