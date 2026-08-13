/** 需要细分的分类配置：分类名 → { 选项列表, 默认值 }
 *  - 手链: 手链 / 手镯（默认手镯）
 *  - 耳环: 耳环_h / 耳环_s（默认耳环_h）
 * 文件名前缀用细分名（如 手镯_10.jpg），而非分类名（手链）。
 */

export const CATEGORY_SUBTYPES: Record<string, { options: string[]; default: string }> = {
  '手链': { options: ['手链', '手镯'], default: '手镯' },
  '耳环': { options: ['耳环_h', '耳环_s'], default: '耳环_h' },
};

/** 分类 → 图片文件前缀：有细分的分类用默认细分名，其余用分类名 */
export function getCategoryFilePrefix(categoryName: string): string {
  return CATEGORY_SUBTYPES[categoryName]?.default ?? categoryName;
}
