# 微生物文明馆 | Microbial Civilization Museum

## 微观交响厅（/symphony）

把馆藏标本听成一段音乐：每条微生物按它的生物学属性被翻译成一组声音参数，几条标本可以叠成一段「微观交响」，支持分享与下载。

### 映射规则（参数推导只在服务端进行）

| 生物学属性 | 声音参数 | 规则 |
| --- | --- | --- |
| 大小 | 音高 | 对数映射 0.05µm~200000µm → C6~C2，越大越低沉 |
| 最适温度 | 音色亮度 | 15~105°C → 低通截止 180Hz~8.1kHz，越嗜热越明亮 |
| 代谢方式 | 节奏疏密 | 需氧 8/16 步 · 兼性 5/16 · 厌氧 3/16 · 专性寄生（病毒）反拍切分 |
| 致病性 | 和声紧张度 | 无害=纯音 → 条件致病=纯五度 → 致病=小三和弦 → 强致病=三全音+小九度 |

- **服务端是唯一权威**：`GET /api/symphony/params` 返回推导好的参数（纯函数 + 整数哈希种子，跨设备、跨时间结果一致）。客户端只消费，不推导。
- **分享**：`/symphony?c=1.5.9`，链接里只有标本 id；接收方打开后重新向服务端取参数，听到的必是同一段。
- **下载**：`POST /api/symphony/renders {ids}` 提交任务，服务端排队渲染 WAV（44.1kHz/16bit，4 小节 + 尾音），客户端轮询 `GET /api/symphony/renders/:jobId` 后从 `/file` 下载。
- **浏览器播放**：纯 Web Audio 手写合成（`src/audio/engine.ts`），不依赖任何音频库。

### 三个容易踩的坑及处理

1. **自动播放策略**：AudioContext 懒创建，且只在用户手势里 `resume()`（首次进入页面的解锁层 + 播放按钮）。不支持 Web Audio 时给出提示并允许无声浏览。
2. **静音 / 减弱动态的替代反馈**：静音只把主增益拉 0，调度器继续运行，16 步可视化与文字状态行持续反馈；系统开启 `prefers-reduced-motion` 时停用全部动画，反馈退化为离散高亮 + 文字，并有 `aria-live` 公告通道。
3. **AudioContext 被系统挂起**：监听 `statechange` / `visibilitychange` / `pageshow`；挂起时调度器原地等待，恢复时把调度指针重新对齐到"现在"，绝不补播积压音符；若恢复需要手势，页面顶部出现"点按恢复"横幅。

### 开发

```bash
npm install
npm run dev        # 同时起 Vite(5173) 与 API(3001)，/api 由 Vite 代理
npm run check      # 类型检查
npm run build      # 生产构建
```

---

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default tseslint.config({
  extends: [
    // Remove ...tseslint.configs.recommended and replace with this
    ...tseslint.configs.recommendedTypeChecked,
    // Alternatively, use this for stricter rules
    ...tseslint.configs.strictTypeChecked,
    // Optionally, add this for stylistic rules
    ...tseslint.configs.stylisticTypeChecked,
  ],
  languageOptions: {
    // other options...
    parserOptions: {
      project: ['./tsconfig.node.json', './tsconfig.app.json'],
      tsconfigRootDir: import.meta.dirname,
    },
  },
})
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default tseslint.config({
  extends: [
    // other configs...
    // Enable lint rules for React
    reactX.configs['recommended-typescript'],
    // Enable lint rules for React DOM
    reactDom.configs.recommended,
  ],
  languageOptions: {
    // other options...
    parserOptions: {
      project: ['./tsconfig.node.json', './tsconfig.app.json'],
      tsconfigRootDir: import.meta.dirname,
    },
  },
})
```
