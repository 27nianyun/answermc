# 项目长期约定（Minecraft 猜物品网页游戏）

技术栈：React 19 + TypeScript + Vite 8 + Tailwind v4 + Framer Motion + @phosphor-icons/react。

## 铁律

1. **未揭晓零泄漏** —— 这是整个项目的第一原则，任何功能都不能破坏它。
   - 四选项要么全出图标、要么全不出；任一贴图失败则整题退回纯文字
   - 不设「题目主角」字段（旧版实测 232/347 道题的主角就是答案）
   - 进度存储只存「维度 key + 计数 + 题 id」，绝不存答案 / 选项文本 / 条目名
   - 提示、方向提示、错题本都不得出现任何选项原文

2. **Hook 位置纪律** —— 所有 Hook（含 `useRef`）必须写在 `if (!question) return null` **之前**。
   本项目已多次栽在同一处。

3. **setState updater 必须是纯函数** —— `<StrictMode>` 会双调用 updater，不能有副作用。

## 常用命令

```bash
npm run dev / build / smoke
npm run check:classes      # 孤儿 class + 未定义 CSS 变量
npm run check:answers      # 答案与解释是否自洽
npm run check:sprites      # 贴图健康
npm run check:responsive   # 6 视口布局
npm run check:browser      # CDP 真实浏览器交互
npm run check:preview      # 预览资源引用
npm run selfcheck          # 跑完上面 6 项并落盘到 src/data/selfcheck.json
```

## 环境陷阱（踩过的坑）

- **`vite preview` 必须加 `--host 127.0.0.1`** —— 默认只绑 IPv6 `::1`，
  `localhost` 通但 `127.0.0.1` 返回 502，而所有检查脚本都连 127.0.0.1。
- **重新构建后必须重启 preview** —— 它缓存 index.html，会一直返回引用旧产物的 HTML。
- **不要用 `taskkill /F /IM node.exe`** —— 会误杀主预览服务，且恢复文件时报 Permission denied。
- **`dist` 被 preview 占用时 `vite build` 会失败** —— 用独立输出目录（`--outDir dist-fault`）做故障注入验证。
- **`check-preview` 第二个位置参数是服务目录**，历史默认 `dist-verify`，本项目用 `dist`。

## 工程原则（血泪教训）

- **写检查脚本后必须注入已知故障验证它真会失败** —— 否则无法区分「没检查出来」和「检查通过」。
  注入故障时要用**确实存在**的目标字符串，之前多次因 `str.replace` 目标不存在而空操作、静默通过。
- **断言失败时先写诊断脚本拿真实状态序列**，再决定改组件还是改测试。
  本项目多次出现「7 条失败但组件其实全对」，全是测试自身前提不成立。
- **两层检查分工**：`check:classes` 管「完全没定义」，`check:browser` 的计算样式断言管「定义了但布局不对」。
- **CSS 变量未定义不报错**，浏览器静默丢弃整条声明。字体一律直写 `ui-monospace, "Cascadia Code", monospace`。
- **子串泄漏判定要先剥版本号 token**，且只对长度 ≥4 的选项判定（`"1"` 会和 `1.21.5` 误命中）。

## 数据基准

- `catalog.json` 2827 条 · `transformations.json` 1096 条（字段名是 `transforms`）· 题库 1014 道
- 数据版本 26.1，最新正式版 26.3「Wilderness Bound」
- 难度：`tier: 'basic' | 'obscure'`，`level: 1 | 2 | 3`；标签「入门/进阶/极限」
- 简单、中等难度只出 MC 基础知识；冷门机制与官方 Bug 只进极限难度
