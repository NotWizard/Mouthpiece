<p align="center">
  <img src="src/assets/icon.png" alt="Mouthpiece" width="120" />
</p>

<h1 align="center">Mouthpiece</h1>

<p align="center">
  开源桌面听写应用（macOS / Windows / Linux）<br/>
  基于 OpenWhispr 与 VoiceInk 持续演进，面向中文/英文输入场景做了专项优化
</p>

## Project Notice (Public Release)

- This project is an **open-source desktop dictation app** that converts speech to text with local and cloud model options.
- **Default mode is BYOK (Bring Your Own Key)**: users provide their own API key / endpoint for cloud providers, or use local models.
- This repository is a **community fork inspired by and based on both OpenWhispr and VoiceInk**, with respect and thanks to both upstream projects. It is **not affiliated with Typeless, OpenWhispr official hosted services, or VoiceInk official services**.
- Recent iterations focus on **explicit BYOK provider integrations** (Alibaba Bailian / Deepgram / Soniox), **realtime dictation UX polish**, and **desktop stability / update flow**.

---

## 对外说明

本项目基于 OpenWhispr（Open Whisper 社区项目）与 VoiceInk 持续演进，并向这两个上游项目致敬；在此基础上针对日常中文/英文输入体验做了增强。

> 当前公开版本的“工程级优化”主要在 **Windows** 平台验证与打磨；macOS/Linux 以基础可用为目标。

### 当前定位

- 开源桌面听写工具（非 SaaS）
- 默认 BYOK 模式，不绑定订阅制

---

## 重点增强与优化

1. **粘贴回退更稳**
   - 当系统判断当前环境不适合直接自动粘贴时，不再强行输入。
   - 文本会保留在复制面板或剪贴板中，用户可以直接 `Ctrl+V` / `Cmd+V` 手动粘贴，减少误输入。

2. **智能词典能力更完整**
   - 支持自定义词典、批量导入，并可把词典提示注入转录与后处理链路，提升术语、专有名词和中英文混输场景的命中率。
   - 批量导入规则也做过针对性优化，实测可直接复制现有词库后快速整理成有效词条。

3. **支持纠错后的持续学习**
   - 用户手动修正识别结果后，可选择回流到词典，逐步改善后续识别效果。
   - 这对高频术语、团队内部名词和个人习惯表达尤其有帮助。

4. **实时转录交互体验做了一轮重写**
   - 悬浮录音胶囊更紧凑，录音波形会根据真实麦克风输入动态变化，不再只是装饰动画。
   - 实时字幕现在支持单行连续滚动展示，录音结束后会自然切换到 `处理中...`，整体观感更顺滑。
   - 同时补了一层流式语音门控，尽量减少刚开始监听但实际上没有说话时出现的伪文本。

5. **云端转录 provider 更明确、切换更灵活**
   - Alibaba Bailian 已升级为独立 provider，不再依赖 `Custom + DashScope Base URL` 这类隐式配置。
   - 同时新增 Deepgram 与 Soniox 一等公民接入，都有独立入口、独立 API Key 和清晰说明。
   - Bailian、Deepgram、Soniox 现在都支持更明确的批量 / 实时转录切换，更方便按延迟和稳定性偏好选择。

6. **自定义端点和智能层设置更顺手**
   - 自定义转录 / 推理 API Key 支持边输入边保存，减少来回保存确认的操作成本。
   - 自定义 OpenAI-compatible 推理与 Bailian 推理都增加了 `enable_thinking` 开关，方便在速度与思考链路之间自行取舍。
   - 同时对智能层做了更严格的约束，尽量降低“模型开始回答问题而不是做转录整理”的风险。

7. **桌面端稳定性与工程体验继续补强**
   - 云端推理请求现在优先走 Electron 主进程代理，降低渲染进程直连时的兼容性和网络异常问题。
   - 旧版通过 DashScope 自定义端点保存的配置会自动迁移到显式的 Alibaba Bailian provider，减少历史配置遗留问题。
   - 打包版应用补齐了后台静默检查更新与控制面板安装提示，同时移除了公开版里不必要的 usage analytics 遗留开关。

---

## BYOK / 可选账号模式

### 自有渠道模式（通常称 BYOK）

- 使用者提供自己的 API Key 与模型端点（或兼容网关）。
- 额度与费用由使用者对应平台账号结算。
- 本项目本身不承诺代付、代管、代计费。

### 可选账号模式（非默认）

- 仅在你自行部署兼容登录/鉴权/计费后端时启用。
- 普通 BYOK / 本地模式不需要账号系统。

---

## 低延迟推荐链路（短文本实时润色）

> 以下速度与价格来自公开资料和第三方实测整理，可能随时间变化，请以官方页面为准。
> 
- **ASR**：阿里云百炼链路（Alibaba Bailian / DashScope compatible mode，默认推荐 `qwen3-asr-flash`）
  - 在中文口语、方言和中文工作流场景通常更稳定，网络路径也较友好。
  - 在 Mouthpiece 中可直接切换到 `qwen3-asr-flash-realtime`，用于边说边显示实时文字。
- **LLM 润色**：Cerebras `gpt-oss-120b`（high）


### 可选润色模型

- Cerebras `gpt-oss-120b`（默认）：质量优先，速度也足够快
- Mercury 2（Inception Labs）：低延迟实时润色表现突出
- Cerebras `llama-3.1-8b`：极低成本 / 高吞吐
- Groq `llama-3.3-70b-versatile`：一个 Key 覆盖 ASR + LLM，部署省事

### 参考对比（短文本润色）

| 推荐顺序 | 提供商 + 模型                | 速度/延迟（参考）     | 价格（参考）               | OpenAI 兼容 |
| -------- | ---------------------------- | --------------------- | -------------------------- | ----------- |
| 1        | Cerebras gpt-oss-120B (high) | ~2248 t/s             | $0.45/M tokens             | 是          |
| 2        | Mercury 2                    | ~1196 t/s             | $0.25/M 输入, $0.75/M 输出 | 是          |
| 3        | Groq Llama 3.3 70B           | ~276 t/s, TTFT ~0.22s | 按 token 计费              | 是          |
| 4        | Cerebras Llama 3.1 8B        | 2200+ t/s             | $0.10/M tokens             | 是          |

### 为什么默认推荐 gpt-oss-120B

- 在本项目“全局润色”场景下，质量与稳定性更平衡。
- 即使单价高于 8B，在免费额度范围内很多个人场景仍可低成本使用。
- OpenAI 协议兼容，迁移成本低。

### Cerebras 定价层级（参考）

| 层级              | 费用                   | 额度                 |
| ----------------- | ---------------------- | -------------------- |
| Free              | $0                     | 每天约 100 万 tokens |
| Developer (PayGo) | 最低充值 $10，按量计费 | 速率限制高于免费层   |
| Enterprise        | 联系销售               | 最高速率 + 专属队列  |

### 兼容性说明

- 阿里云百炼 / DashScope 支持 OpenAI compatible mode。
- 在 Mouthpiece 的“转录设置”里，Alibaba Bailian 现在是独立的云端转录 provider，可直接单独填写 API Key，并在同一张 provider 卡片内切换批量/实时转录。
- 开启 Bailian 实时转录时，应用会走 `qwen3-asr-flash-realtime` 的 WebSocket 流式链路，并在录音过程中显示单行实时文字；关闭时继续使用 `qwen3-asr-flash` 的常规批量转录。
- `Custom` provider 保留给任意 OpenAI-compatible 转录端点，不再承担百炼的隐式入口职责。
- 旧版通过 `Custom + DashScope Base URL` 保存的转录配置，会在应用启动时自动迁移到显式的 Alibaba Bailian provider。
- 对支持自定义 OpenAI Base URL 的客户端，通常也可直接接入。
- 常用 Base URL（北京）：`https://dashscope.aliyuncs.com/compatible-mode/v1`

### 参考端点与示例环境变量

> Mouthpiece 桌面端优先建议直接在设置页选择 `Alibaba Bailian` provider。下面的环境变量示例主要用于其他兼容客户端、自建脚本，或需要显式声明端点的场景。

```bash
# ASR (Alibaba Bailian / DashScope compatible mode)
DASHSCOPE_API_KEY=your_dashscope_key
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
# model: qwen3-asr-flash

# LLM polish (default recommendation)
OPENAI_API_KEY=your_cerebras_key
OPENAI_BASE_URL=https://api.cerebras.ai/v1
# model: gpt-oss-120b

# Alternative: Mercury 2
# MERCURY_API_KEY=your_mercury_key
# MERCURY_BASE_URL=https://api.inceptionlabs.ai/v1
# MERCURY_MODEL=mercury-2
```

---

## Windows 启动方式

**安装包用户（推荐）**：直接运行 NSIS 安装程序，安装器会自动在桌面和开始菜单创建 `Mouthpiece` 快捷方式，双击即可。

**源码 / 便携版用户**：仓库提供了 `core/` 启动器，避免双击 `.bat` 时出现黑色命令行窗口：

- `core/Mouthpiece-Launch.vbs`：推荐入口，静默启动（无黑框闪屏）。
- `core/Mouthpiece-Launch.bat`：启动逻辑，优先找 `dist\win-unpacked\Mouthpiece.exe`，若不存在则回退到 `npm start`。
- `core/Create-Mouthpiece-DesktopShortcut.ps1`：为源码用户创建桌面快捷方式。

```powershell
# 在仓库根目录执行（Windows PowerShell）
powershell -ExecutionPolicy Bypass -File .\core\Create-Mouthpiece-DesktopShortcut.ps1
```

## Quick Start

```bash
git clone https://github.com/le-soleil-se-couche/Mouthpiece.git
cd Mouthpiece
npm install
npm run dev
```

Build:

```bash
npm run build
```

> 需要更多平台打包/本地模型说明，可查看仓库内 `LOCAL_WHISPER_SETUP.md`、`WINDOWS_TROUBLESHOOTING.md`、`TROUBLESHOOTING.md`。

---

## Legal & Risk Disclosure

1. 本项目按 MIT License 提供，不附带任何明示或暗示担保。
2. 使用云端模型时，数据将按你所选提供商策略处理；请自行确认其隐私政策与合规要求。
3. 语音转文本和智能后处理可能出现误识别、误改写，涉及法律、医疗、财务等高风险场景请务必人工复核。
4. 本项目不提供投资、医疗、法律等专业建议功能。

---

## Upstream & References

- OpenWhispr 原始仓库: https://github.com/OpenWhispr/openwhispr
- VoiceInk 原始仓库: https://github.com/le-soleil-se-couche/VoiceInk
- Cerebras 免费 Key: https://cloud.cerebras.ai
- Cerebras 快速开始: https://inference-docs.cerebras.ai/quickstart
- Cerebras 定价: https://www.cerebras.ai/pricing
- Cerebras API 文档: https://inference-docs.cerebras.ai
- Cerebras Playground: https://chat.cerebras.ai
- Cerebras GitHub 示例: https://github.com/Cerebras/inference-examples
- Artificial Analysis（Cerebras）: https://artificialanalysis.ai/providers/cerebras
- 阿里云百炼控制台（DashScope compatible mode）: https://bailian.console.aliyun.com/

---

## License

MIT. See [LICENSE](LICENSE).
