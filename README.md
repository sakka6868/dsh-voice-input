# @sakka6868/dsh-voice-input

> DeepSeek Harness Web UI 的「语音输入」插件 —— 点一下麦克风（或按 `Ctrl+Shift+M`），边说边把话实时变成输入框里的文字，停止后自动校对。

[![npm version](https://img.shields.io/npm/v/@sakka6868/dsh-voice-input)](https://www.npmjs.com/package/@sakka6868/dsh-voice-input)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![language](https://img.shields.io/badge/plain%20javascript-ES2020-yellow)
![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)

## ✨ 核心亮点

- **实时转录** — 使用浏览器原生 Web Speech API（Edge 中后端即**微软语音服务**），说话时文字逐字出现在输入框，无录音文件、无本地模型、无等待；
- **零依赖零配置** — 不需要 API Key、不下载模型、不占用 CPU；
- **自动校对** — 停止说话后静默调用当前会话模型校对：修正错别字、同音/近音转录偏差、繁体转简体、理顺标点；**你手动改过输入框就不会覆盖**；
- **快捷键** — `Ctrl+Shift+M` 一键开始/停止语音输入；
- **位置贴合** — 麦克风按钮固定在发送按钮左侧（flex `order:1`，与内置控件同排）；
- **无打扰 UI** — 录音过程不弹出任何面板/浮层，输入框里的文字就是全部反馈；
- **干净可逆** — 只写输入框草稿，是否发送完全由你决定；卸载即移除按钮、快捷键与样式。

## 安装与使用

### 方式一：静态插件（npm 包，推荐）

```powershell
dsh plugin --profile web add @sakka6868/dsh-voice-input
```

然后在 `~/.dsh/profiles/web/cordis.patch.yml` 注册插件行：

```yaml
- insert:
    - id: dsh-voice-input
      name: '@sakka6868/dsh-voice-input'
```

重启 DSH web 服务后，输入栏发送按钮左侧出现麦克风按钮。

### 方式二：Dynamic 模式（开发/尝鲜）

在 DSH 的 Cordis 动态插件面板：

1. 新建插件（idPrefix 如 `voice`）；
2. `code.host` 粘贴 `lib/index.js` 中 `proofread` 相关逻辑（或改用 `harness.handle('voice.proofread', ...)` 形态）；
3. `code.client` 粘贴 `lib/client.js` 中组件与状态机逻辑（把 `fetch` 换回 `host.call`、把 `<style>` 注入换回 `styles.insert`、把原生定时器换回 `ctx.timeout`）；
4. 激活并授权。

## 使用说明

| 操作 | 效果 |
| --- | --- |
| 点击 🎤 或按 `Ctrl+Shift+M` | 开始语音识别（首次会请求麦克风权限），文字实时写入输入框 |
| 再次点击红色停止钮或 `Ctrl+Shift+M` | 结束识别，静默校对后回填（未改动则替换，改动过则保留你的版本） |
| 停顿约 1.5 秒 | 自动结束识别 |
| 按原有发送按钮 | 发送输入框中的文字 |

识别语言固定为 `zh-CN`（可在 `lib/client.js` 的 `createRecognition()` 中修改 `rec.lang`）。

## 工作原理

```
浏览器 Web Speech API (实时识别, Edge→微软语音服务)
        │  interim/final 结果
        ▼
conversation.input.right 麦克风按钮 → inputActions.setDraft(文字)  ← 实时写入输入框
        │  停止 / 停顿 1.5s
        ▼
POST /dsh-voice-input/proofread  (Host 半, webServer 路由)
        │  ctx.get('llm') + ctx.get('agentDefaultModel')
        ▼
校对文本 → 回填输入框（仅在草稿未被用户修改时）
```

- **Client 半**（`lib/client.js`）：module-loader factory 包，注册 `conversation.input.right`（按钮）与 `conversation.input.dock`（错误提示），快捷键监听挂在 `document`，卸载时清理。
- **Host 半**（`lib/index.js`）：一个 `webServer` exact POST 路由，用会话默认模型做一次低温度校对调用；任何服务缺失或调用失败都退化为“原样返回转写文本”，不会打断输入。

## 兼容性与限制

- **Edge / Chrome**：完整可用（Web Speech API 需要联网，识别在浏览器厂商的语音服务端完成）；
- **Firefox**：不支持 `SpeechRecognition`，按钮会提示改用 Edge/Chrome；
- **Safari**：部分版本支持 `webkitSpeechRecognition`，`continuous` 行为可能不同；
- 离线环境无法识别（语音服务在云端）；
- 校对依赖当前会话是否配置了可用模型；未配置时保留原始转写。

## 许可

[MIT](LICENSE)
