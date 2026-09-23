# 心情日历 · 黏土表情素材

> 历史方案：当前页面已切换到平面表情徽章，见 [v2 设计与素材说明](mood-design-v2.md)。此处保留 v1 绘制记录，图片不再被页面引用。

使用内置 image_gen 绘制（非 CLI/API 脚本），2026-09-24。运行项目不需要图像生成服务或 API Key。

## 文件与接入

五张最终 PNG 位于 `internal/httpapi/assets/mood-art/`：
- `awful-clay-v1.png`：很糟，淡紫色，紧闭双眼、颤抖嘴型与一滴眼泪。
- `low-clay-v1.png`：低落，粉蓝色，低垂眼睛与下弯嘴角。
- `neutral-clay-v1.png`：平静，鼠尾草绿，放松闭眼。
- `good-clay-v1.png`：不错，杏桃色，睁眼微笑。
- `great-clay-v1.png`：很好，奶油黄色，弯眼开怀笑。

保留原始 RGBA 透明度。图片在心情选择器、日历格子、图例、月度统计、走势图和页头装饰中复用。沿用原有心情枚举，不改动历史记录。
HTML 图片有固定宽高比、空 alt（由按钮/文字提供标签）、禁止拖拽和延迟加载。替换素材时使用新版本文件名，并同步 HTML 与 app.js 引用。

## 最终提示词

### 平静：基础角色

Use case: stylized-concept.
Asset type: one production-ready mood selector icon for a beautifully designed personal journal app, NOT a UI mockup.
Primary request: draw ONE original adorable but sophisticated little emotion character expressing NEUTRAL / PEACEFUL, a quiet restful feeling, neither happy nor sad.
Art direction: premium soft 3D clay illustration, a gently irregular rounded mochi pebble creature, slightly wider than tall, no body, no limbs, no hair, no accessories. Plush matte porcelain-clay surface, beautifully sculpted volume, subtle tactile fine grain, softly rolled edges. Tiny expressive dark cocoa facial features sculpted into the surface. Sleepy relaxed horizontal eyelids, a tiny relaxed horizontal mouth, restrained warm pink cheeks. Pale sage green main color, gentle cream-lit highlights and muted mint shadows. Not a stock yellow emoji, not a flat vector, no heavy outlines, no plastic glare.
Composition: square canvas, orthographic front view at eye level, centered single face. The character fills 80 percent of canvas width and about 74 percent of canvas height. Identical ample safe padding all around. Large unmistakable facial expression readable at 40 pixels.
Lighting: large warm softbox from upper left, delicate ambient occlusion, no floor shadow outside the silhouette.
Background: genuinely transparent RGBA alpha, clean cutout edges, no white rectangle, no checkerboard pattern, no background scene.
Constraints: only one character, no text, no letters, no watermark, no border, no emoji copied from any existing platform. Output a polished finished image.

### 其他四张：独立生成，以平静图片作为风格参考

每张使用以下对应提示词，参考图为 `neutral-clay-v1.png`，不是拼贴图或截图。

#### awful

undefined

#### low

undefined

#### good

undefined

#### great

undefined

## 验证

- `node tools/mood_ui_smoke.cjs`：本地 PNG 引用、透明通道、角色匹配、键盘选择状态、记录保存与草稿保护。
- `go test ./internal/httpapi -run TestHomeAndStaticAssetsAreServed`：HTTP 图片路由、PNG 解码、透明边角和有效角色内容。
