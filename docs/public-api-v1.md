# Cosmos Vision 公开接口 1.0

同一 SillyTavern 页面通过 `window.CosmosVision` 调用。精确类型见
[cosmos-vision-public-api-v1.d.ts](./cosmos-vision-public-api-v1.d.ts)。本实现遵循回声小剧场提供的 1.0 约定，没有修改调用方插件。

## 调用示例

```js
const cv = window.CosmosVision;
if (!cv || cv.apiVersion.split('.')[0] !== '1') {
  throw new Error('请加载兼容的 Cosmos Vision 插件');
}
const capabilities = await cv.getCapabilities();
if (!capabilities.ready || !capabilities.enabled) {
  throw new Error(capabilities.reason || 'Cosmos Vision 暂不可用');
}

const controller = new AbortController();
const draft = await cv.preparePrompt(
  {
    mode: 'theater',
    imageSource: capabilities.defaultImageSource,
    theaterText: '清晨，两人各自出门。夜晚，他们在雨中的车站重逢。',
    context: {
      mode: 'provided',
      source: { client: 'titania-theater', sceneId: 'caller-owned-scene-id' },
      participants: '',
      history: [],
    },
    specialRequest: '画重逢的一瞬间，远景，冷色。',
  },
  {
    requestId: crypto.randomUUID(),
    signal: controller.signal,
    onProgress: event => console.log(event.requestId, event.stage),
  },
);

// 在调用方 UI 中展示 scene 和 prompts；用户确认后再调用 generate。
// draft 可 JSON 序列化保存，prompts 中已经包含画师串、质量词等最终文字。
draft.prompts.positivePrompt += ', soft rain';
const result = await cv.generate(
  { draft, count: 1 },
  {
    requestId: crypto.randomUUID(),
    signal: controller.signal,
  },
);
const { blob, mimeType, width, height, seed } = result.images[0];
// 由调用方保存 blob；预览时如使用 URL.createObjectURL，应自行 revokeObjectURL。
```

`preparePrompt` 只进行一次选景与提示词 LLM 请求。`generate`
不再次运行 LLM，不重新抽取画师串，不再次合并固定提示词或 LoRA 触发词。调用方可修改正负提示词和 NovelAI 人物提示词。

## 注册与能力

- 注册后触发 `cosmos-vision:ready`；此时对象已存在，初始化可能尚未完成。调用方应同时直接检查全局对象。
- `getCapabilities().ready` 表示扩展运行配置已经初始化，`enabled` 表示总开关。`imageSources[].ready`
  是各来源的本地配置检查结果，不代表已请求后端验证连接。缺少提示词 LLM 时会给出中文 `reason`，prepare 抛出
  `LLM_NOT_CONFIGURED`；已有草稿仍可生图。
- 初始化或已应用的设置变化时触发 `cosmos-vision:capabilities-changed`。两个事件均不携带设置或凭据。
- 默认来源来自 Cosmos 当前已应用的配置；调用方也可显式选择另一个可用来源。
- API 可以在设置面板挂载前初始化，调用无需聊天 DOM、楼层 ID 或 Vue 组件。

## 小剧场预设与上下文

小剧场使用 Cosmos 现有的消息预设，不再单独维护一套选景预设：省略 `presetId` 时用当前激活预设（默认即内置「默认预设」）。请求的 `presetId` 可以选择已保存的其他消息预设，仅影响本次调用，也不会切换全局激活项。旧设置里残留的
`prompt-llm-theater-preset` 会在规范化时移除；若它正是激活项，激活项回落到内置默认预设。

正文按内置预设的焦点段落口径注入 `<main_scene>`，同时仍按 `{{theater_text}}` 提供。支持的模板宏为
`{{focus_paragraph}}`、`{{theater_text}}`、`{{participants}}`、`{{history}}`、`{{special_request}}`、`{{previous_scenes}}`。无论预设是否引用这些宏，接口都会完整附加本次正文及显式上下文。小剧场使用固定的 scene/positivePrompt/negativePrompt/characterPrompts 输出字段；末尾的输出规则说明传进来的是尚未选景的完整作品。现有「优先 JSON Schema 解析」开关决定是否附带该结构的 JSON Schema。

`context.mode: 'provided'`
不读取当前角色、世界书、聊天历史、人物档案或用户人设。空 participants/history 合法。sceneId 仅作为调用方关联信息。世界书引用与 EJS 模板会报
`UNSUPPORTED_CONTEXT`；其余宏形文本（如内置预设文档里的 `{{tag}}`、`{{char}}`）不展开、按字面发送，调用方正文里的宏形文本同样保持字面内容。

为避免酒馆助手 generateRaw 内部的聊天读取和临时聊天修改，公开接口复用 Cosmos 的账号路由、代理配置和生成参数，通过酒馆后端发送一条独立的非流式 LLM 请求。此路径不调用全局生成停止接口，也不触发聊天生成事件。

每次 prepare 的请求与响应会记录进 Cosmos 自己的「LLM 请求监视」（内存态，刷新即清空，不落盘），用于联调时核对实际发送的指令与模型返回；记录只含账号名、脱敏后的连接文本、模型、消息与响应，不含密钥、代理密码或认证头。

一次选择一个时空中的具体瞬间，返回 `scene.summary`（一至三句中文画面描述，用作配图说明；不再要求逐字摘录正文）。无法选景报 `NO_SCENE`。传入 `previousScenes` 可优先选择其他有依据的画面。

## 草稿和生图配置

- 草稿只包含公开类型声明中的字段，可以刷新后反序列化使用。每次使用新的 requestId，允许同一草稿重复生图。
- 正负提示词和人物提示词会去除首尾空白，结果中的 draft 是实际使用的规范化草稿。
- 人物坐标始终为连续的 0–1，NovelAI V4/V4.5/V5 的 0 和 1 不会被误读为旧的网格索引。
- NovelAI
  V3 和当前 ComfyUI 绑定不支持独立人物提示词，人物描述应合并到正向提示词，characterPrompts 使用空数组。模型返回不支持的独立人物字段会报
  `INVALID_RESPONSE`；用户提交此类草稿会报 `INVALID_REQUEST`。
- 每次调用开始、任何异步处理和进度回调之前保存配置与输入快照。图幅、步数、采样器、LoRA、Vibe 等使用 generate 开始时的配置。改变这些配置不会重新合并草稿文字。
- NovelAI 模型改变，或 ComfyUI 工作流身份、模型、拓扑或绑定改变时，旧草稿报
  `CONFIG_CHANGED`。ComfyUI 标识是不包含工作流明文或凭据的不透明指纹；普通图幅、采样参数、种子和 LoRA 配置变化不改变该标识。
- ComfyUI 当前角色/用户头像绑定在公开接口中报 `UNSUPPORTED_CONTEXT`。
- v1 每次只接受
  `count: 1`。NovelAI 显式发送一张；ComfyUI 已知 batch_size 标量约束为 1，并只下载选定输出节点的第一张图片。工作流内部仍产生多张时按输出顺序裁取，不另发生成请求。
- 图片返回真实 Blob、经文件签名和浏览器解码验证的 PNG/JPEG/WebP
  MIME 与实际尺寸。种子能够确定时返回；ComfyUI 多个不同种子无法对应单图时省略。
- 不写入聊天正文、内联图库、Cosmos 临时图片或收藏；图片保存和展示由调用方管理。

## 请求控制与错误

正文、人物资料、历史、特别要求与 previousScenes 的文本合计上限为 100000 个 JavaScript 字符（UTF-16 code
units），草稿文本也有同等上限。不会静默截断正文。requestId/presetId/sceneId 上限为 256 个字符。

当前公开接口同时接收一个任务，其他请求报
`BUSY`，调用方可稍后重试。当前页面保留最近 256 个已接收的请求 ID（包括失败、取消）；重复 ID 报
`DUPLICATE_REQUEST`。刷新后的去重不跨页面保存。prepare 和 generate 必须各用新的 ID；prepare 返回类型为 PromptDraft，进度事件携带其 ID；generate 的结果包含本次 ID。

取消及时抛出 `name: 'AbortError', code: 'ABORTED'`。取消后的结果和后续进度会丢弃。ComfyUI 只撤销本次等待，**不发送共享
`/interrupt`**；后端计算可能继续，不能据此判断停止计费。LLM 和图片请求的超时继承对应 Cosmos 配置，报 `TIMEOUT`。

公开接口的一次任务只选择一个路由账号提交；网络或响应失败后不会自动换账号再提交，以免不确定的失败导致重复计费。日常生图仍保留已有账号故障转移策略。

错误均为带中文 message 与字符串 code 的 Error。支持
`NOT_READY`、`DISABLED`、`INVALID_REQUEST`、`TEXT_TOO_LONG`、`UNSUPPORTED_MODE`、`UNSUPPORTED_CONTEXT`、`PROVIDER_NOT_CONFIGURED`、`LLM_NOT_CONFIGURED`、`CONFIG_CHANGED`、`NO_SCENE`、`INVALID_RESPONSE`、`BUSY`、`DUPLICATE_REQUEST`、`TIMEOUT`、`GENERATION_FAILED`、`ABORTED`。错误和进度不透传原始服务响应、账号、密钥、认证头或请求体。

## 验证

Mock 测试位于
`tests/unit/services/public-api/`，覆盖配置状态、同页注册、上下文和宏隔离、预设迁移、选景摘录、可编辑草稿、快照、模型变化、单次提交、取消与超时、并发去重、输出图片校验与凭据隔离。

```sh
npm run typecheck
npm run test
npm run build
```

真实 NovelAI/ComfyUI 联调需另行验证服务连通性、各 LLM 模型的选景质量、实际工作流/LoRA/Vibe 输出以及浏览器图片解码。Mock 通过不代表真实后端已完成联调。
