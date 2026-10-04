/**
 * 确定性伪随机数。
 *
 * 为什么单独一个文件：题库的「选项打乱」和新玩法的出题都要用种子随机，
 * 两份实现迟早会漂移 —— 同一个 seed 在两处算出不同结果，
 * 「每日挑战」这类靠种子复现的功能就会直接失效。
 *
 * 算法是 mulberry32 + FNV-1a 字符串散列：
 *  - 只依赖 seed，同 seed 永远同结果（这是每日挑战与回归测试的前提）
 *  - 比 Math.random() 均匀，且不需要外部依赖
 *  - 不传 seed 时才退化成真随机（用于「换一题」）
 */

export const hashString = (value: string): number => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/** 返回一个 [0, 1) 的伪随机函数 */
export const makeRandom = (seed?: string): (() => number) => {
  let state = seed ? hashString(seed) : (Math.random() * 0xffffffff) >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/** 用给定随机源做 Fisher–Yates 洗牌，返回新数组（不改原数组） */
export const shuffleWith = <T>(items: readonly T[], random: () => number): T[] => {
  const out = [...items]
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1))
    const temp = out[index]
    out[index] = out[swap]
    out[swap] = temp
  }
  return out
}

/** 从数组里随机取 n 个不重复元素（不够就全给） */
export const sampleWith = <T>(items: readonly T[], n: number, random: () => number): T[] =>
  shuffleWith(items, random).slice(0, n)
