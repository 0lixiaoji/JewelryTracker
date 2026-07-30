/** 从源图片生成 Android App 图标（所有密度）
 *
 * 用法: node scripts/generate-icons.mjs <源图片路径>
 * 输出: android/app/src/main/res/mipmap-{density}/ic_launcher*.png
 */

import { Jimp } from 'jimp';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const SRC = process.argv[2];
if (!SRC || !existsSync(SRC)) {
  console.error('请提供有效的源图片路径');
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const RES_DIR = join(__dirname, '..', 'android', 'app', 'src', 'main', 'res');

const DENSITIES = [
  { name: 'mdpi', size: 48 },
  { name: 'hdpi', size: 72 },
  { name: 'xhdpi', size: 96 },
  { name: 'xxhdpi', size: 144 },
  { name: 'xxxhdpi', size: 192 },
];

const FOREGROUND_RATIO = 0.66;

async function generate() {
  console.log(`源图片: ${SRC}`);
  const src = await Jimp.read(SRC);

  for (const d of DENSITIES) {
    const dir = join(RES_DIR, `mipmap-${d.name}`);
    mkdirSync(dir, { recursive: true });

    // ── 方形 / 圆形图标 ──
    const icon = src.clone().cover({ w: d.size, h: d.size });
    await icon.write(join(dir, 'ic_launcher.png'));
    // 圆形用同一张图（Android launcher 自动裁剪为圆形）
    await icon.write(join(dir, 'ic_launcher_round.png'));

    // ── 自适应图标前景（内缩 66%，透明背景） ──
    const fgSize = Math.round(d.size * FOREGROUND_RATIO);
    const padding = Math.round((d.size - fgSize) / 2);

    const fg = new Jimp({ width: d.size, height: d.size, color: 0x00000000 }); // 透明背景
    const logoSmall = src.clone().cover({ w: fgSize, h: fgSize });
    fg.composite(logoSmall, padding, padding);
    await fg.write(join(dir, 'ic_launcher_foreground.png'));

    console.log(`  ${d.name}: ${d.size}x${d.size} ✓`);
  }

  // ── 更新自适应图标 XML（Android 8+） ──
  const bgXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>`;

  const anydpiDir = join(RES_DIR, 'mipmap-anydpi-v26');
  mkdirSync(anydpiDir, { recursive: true });
  writeFileSync(join(anydpiDir, 'ic_launcher.xml'), bgXml);
  writeFileSync(join(anydpiDir, 'ic_launcher_round.xml'), bgXml);

  // ── 更新背景色为品牌色 #d4a574 ──
  const colorsXml = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#D4A574</color>
</resources>`;

  const valuesDir = join(RES_DIR, 'values');
  mkdirSync(valuesDir, { recursive: true });
  writeFileSync(join(valuesDir, 'colors.xml'), colorsXml);

  console.log('\n✅ 所有图标生成完成！');
}

generate().catch((err) => {
  console.error('图标生成失败:', err);
  process.exit(1);
});
