# 心情日历：统一视觉（v2）

## 参考与判断

- [Moodpress 官方商店](https://play.google.com/store/apps/details?id=com.selfcare.diary.mood.tracker.moodpress&hl=en_US)
- [Moodpress 较早版本的公开日历截图](https://meta.appinn.net/t/topic/27873)

官方商店图片服务器在本次环境中无法连接，因此实际视觉观察以第二个来源的 2021 年日历/统计截图为准，不将其描述为最新版本。参考图片仅保存在忽略的 tmp 目录，未作为应用素材使用。

观察到的共同点：简洁背景、重复而稳定的表情符号、日历和统计共用情绪颜色、较少的容器装饰。以下是针对 StudyFlow 的设计判断，并非 Moodpress 官方规范：

1. 表情是记录内容，不是页面大幅装饰；移除大幅页头角色和渐变。
2. 日期格子使用留白、轻量圆点及表情；仅选中日期显示边框。
3. 同一种心情从选择器到统计条、走势图点位使用同一颜色。
4. 保留平台字体与主题变量，中文标题清晰，桌面两行卡片继续对齐。
5. 不复制 Moodpress 猫咪图形；使用原创平面表情徽章。

## 当前素材

使用内置 image_gen 生成，不是 CLI/API 路径。运行时无需调用生成服务。
文件位于 `internal/httpapi/assets/mood-art/`：

- `awful-flat-v2.png`：色底 #BAA9DC，五官 #594578。
- `low-flat-v2.png`：色底 #8CBAD8，五官 #365C78。
- `neutral-flat-v2.png`：色底 #AACBA6，五官 #3C6149。
- `good-flat-v2.png`：色底 #F4BA8F，五官 #85522F。
- `great-flat-v2.png`：色底 #EFD064，五官 #795B23。

这是完整不透明的方形徽章纹理。应用中 HTML 图片以 `border-radius:50%` 呈现，SVG 走势图通过同一圆形 clipPath 呈现；不是把正方形大图直接显示在日历内。
第一次尝试的透明图存在镂空缺陷，未接入或保存进项目。原 v1 黏土素材仅保留用于回退，目前没有页面引用。

## 最终提示词

### awful

Use case: stylized-concept.
Create ONE beautifully balanced flat illustrated emotion badge texture for a minimal mood diary app.
Canvas: SQUARE. The ENTIRE image from edge to edge is a perfectly SOLID OPAQUE uniform color #BAA9DC. No transparent pixels anywhere. No separate head outline or silhouette. No gradient, no lighting, no shadow, no holes, no texture, no realistic material. The app will circularly clip this square; you must fill the whole square completely.
Only draw a small original expressive face in the center using flat #594578 ink. Expression: distressed: tightly squeezed sideways-chevron eyes, a small trembling downward mouth, short worried eyebrows. No tears or props. Small restrained darker-tone oval cheeks. Friendly rounded stroke ends, expressive polished hand-drawn curves, balanced symmetry. Face occupies central 48% of the canvas width and 32% height. Keep all marks safely inside the central 65% circle. Pure 2D stationery illustration with uniform stroke thickness, immediately legible at 32 pixels.
Do NOT draw a 3D toy, clay, plush, sphere, handle, ring, topknot, ears, nose, body, limbs, glints, scenery or floating decorations. NO black patch or shading above the face. NO background removal: preserve the opaque full-bleed solid color canvas. No text, no captions, no watermark. Single flat face, not a grid or screenshot.

### low

Use case: stylized-concept.
Create ONE beautifully balanced flat illustrated emotion badge texture for a minimal mood diary app.
Canvas: SQUARE. The ENTIRE image from edge to edge is a perfectly SOLID OPAQUE uniform color #8CBAD8. No transparent pixels anywhere. No separate head outline or silhouette. No gradient, no lighting, no shadow, no holes, no texture, no realistic material. The app will circularly clip this square; you must fill the whole square completely.
Only draw a small original expressive face in the center using flat #365C78 ink. Expression: sad: two little downcast oval eyes, short worried brows, a small downward-curving frown. Small restrained darker-tone oval cheeks. Friendly rounded stroke ends, expressive polished hand-drawn curves, balanced symmetry. Face occupies central 48% of the canvas width and 32% height. Keep all marks safely inside the central 65% circle. Pure 2D stationery illustration with uniform stroke thickness, immediately legible at 32 pixels.
Do NOT draw a 3D toy, clay, plush, sphere, handle, ring, topknot, ears, nose, body, limbs, glints, scenery or floating decorations. NO black patch or shading above the face. NO background removal: preserve the opaque full-bleed solid color canvas. No text, no captions, no watermark. Single flat face, not a grid or screenshot.

### neutral

Use case: stylized-concept.
Create ONE beautifully balanced flat illustrated emotion badge texture for a minimal mood diary app.
Canvas: SQUARE. The ENTIRE image from edge to edge is a perfectly SOLID OPAQUE uniform color #AACBA6. No transparent pixels anywhere. No separate head outline or silhouette. No gradient, no lighting, no shadow, no holes, no texture, no realistic material. The app will circularly clip this square; you must fill the whole square completely.
Only draw a small original expressive face in the center using flat #3C6149 ink. Expression: peaceful neutral: two short horizontal relaxed eyes, a short horizontal mouth, no eyebrows. Small restrained darker-tone oval cheeks. Friendly rounded stroke ends, expressive polished hand-drawn curves, balanced symmetry. Face occupies central 48% of the canvas width and 32% height. Keep all marks safely inside the central 65% circle. Pure 2D stationery illustration with uniform stroke thickness, immediately legible at 32 pixels.
Do NOT draw a 3D toy, clay, plush, sphere, handle, ring, topknot, ears, nose, body, limbs, glints, scenery or floating decorations. NO black patch or shading above the face. NO background removal: preserve the opaque full-bleed solid color canvas. No text, no captions, no watermark. Single flat face, not a grid or screenshot.

### good

Use case: stylized-concept.
Create ONE beautifully balanced flat illustrated emotion badge texture for a minimal mood diary app.
Canvas: SQUARE. The ENTIRE image from edge to edge is a perfectly SOLID OPAQUE uniform color #F4BA8F. No transparent pixels anywhere. No separate head outline or silhouette. No gradient, no lighting, no shadow, no holes, no texture, no realistic material. The app will circularly clip this square; you must fill the whole square completely.
Only draw a small original expressive face in the center using flat #85522F ink. Expression: content: two little oval open eyes and a friendly small upward-curving smile, no eyebrows. Small restrained darker-tone oval cheeks. Friendly rounded stroke ends, expressive polished hand-drawn curves, balanced symmetry. Face occupies central 48% of the canvas width and 32% height. Keep all marks safely inside the central 65% circle. Pure 2D stationery illustration with uniform stroke thickness, immediately legible at 32 pixels.
Do NOT draw a 3D toy, clay, plush, sphere, handle, ring, topknot, ears, nose, body, limbs, glints, scenery or floating decorations. NO black patch or shading above the face. NO background removal: preserve the opaque full-bleed solid color canvas. No text, no captions, no watermark. Single flat face, not a grid or screenshot.

### great

Use case: stylized-concept.
Create ONE beautifully balanced flat illustrated emotion badge texture for a minimal mood diary app.
Canvas: SQUARE. The ENTIRE image from edge to edge is a perfectly SOLID OPAQUE uniform color #EFD064. No transparent pixels anywhere. No separate head outline or silhouette. No gradient, no lighting, no shadow, no holes, no texture, no realistic material. The app will circularly clip this square; you must fill the whole square completely.
Only draw a small original expressive face in the center using flat #795B23 ink. Expression: joyful: two upward curved smiling crescent eyes and a simple broad open laughing mouth with one small flat tongue, no teeth. Small restrained darker-tone oval cheeks. Friendly rounded stroke ends, expressive polished hand-drawn curves, balanced symmetry. Face occupies central 48% of the canvas width and 32% height. Keep all marks safely inside the central 65% circle. Pure 2D stationery illustration with uniform stroke thickness, immediately legible at 32 pixels.
Do NOT draw a 3D toy, clay, plush, sphere, handle, ring, topknot, ears, nose, body, limbs, glints, scenery or floating decorations. NO black patch or shading above the face. NO background removal: preserve the opaque full-bleed solid color canvas. No text, no captions, no watermark. Single flat face, not a grid or screenshot.

## 验证范围

- 前端回归覆盖素材引用、圆形裁剪声明、统一颜色标记、深色/减少动画样式，以及记录保存、草稿保护。
- Go 静态资源测试验证 HTTP 路径、图片类型、尺寸和不透明像素。
- 当前浏览器工具返回 `Browser is not available: iab`，未完成真实浏览器截图验收；代码结构检查不能替代实际视觉验收。

