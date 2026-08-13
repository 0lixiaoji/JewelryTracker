/** 分类主色 — 仪表盘卡片 & 首饰卡片共用的荧光发圈色 */

// 按分类名查主色（未命中时回退到盒子色）
export const CATEGORY_ACCENTS: Record<string, string> = {
  发圈: '#e890a0',
  发卡: '#e89850',
  耳环: '#50c8b8',
  项链: '#d4a848',
  手链: '#9888d8',
  戒指: '#6098d8',
  眼影: '#e88060',
  口红: '#e84858',
  盒子: '#68c068',
};

export const DEFAULT_ACCENT = CATEGORY_ACCENTS['盒子'];

// 9 色循环数组（按 sort_order 排列：发卡/发圈/眼影/耳环/口红/项链/手链/戒指/盒子）
// 用于首饰卡片按位置循环取色：第 n 张卡片用 ACCENT_CYCLE[n % 9]
export const ACCENT_CYCLE: string[] = [
  CATEGORY_ACCENTS['发卡'],
  CATEGORY_ACCENTS['发圈'],
  CATEGORY_ACCENTS['眼影'],
  CATEGORY_ACCENTS['耳环'],
  CATEGORY_ACCENTS['口红'],
  CATEGORY_ACCENTS['项链'],
  CATEGORY_ACCENTS['手链'],
  CATEGORY_ACCENTS['戒指'],
  CATEGORY_ACCENTS['盒子'],
];

// 双类型分类（手链/耳环）的冷暖色系循环：
// 数量多的类型用暖色系（6 色，循环更长），数量少的类型用冷色系（3 色）
export const WARM_CYCLE: string[] = [
  CATEGORY_ACCENTS['发卡'],
  CATEGORY_ACCENTS['发圈'],
  CATEGORY_ACCENTS['眼影'],
  CATEGORY_ACCENTS['口红'],
  CATEGORY_ACCENTS['项链'],
  CATEGORY_ACCENTS['手链'],
];

export const COOL_CYCLE: string[] = [
  CATEGORY_ACCENTS['耳环'],
  CATEGORY_ACCENTS['戒指'],
  CATEGORY_ACCENTS['盒子'],
];
