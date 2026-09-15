# 词序

面向大一和英语基础较弱学习者的四六级背词网站。根据考试日期与高考英语成绩安排新词量，通过整句听力、双语理解和间隔复习记忆单词。

## 本地运行

```bash
npm install
node --experimental-transform-types scripts/fetch-cloud-audio.mjs
npm run dev
```

## 静态构建

```bash
npm run build
```

静态文件生成在 `dist`。仓库中的 GitHub Actions 工作流会在 `main` 分支更新后自动部署 GitHub Pages。

## 全量云端语音

正式页面的单词、整句、分句和例句点词统一播放预生成的 MP3，支持调速、
暂停、重听和失败重试。浏览器不会下载语音模型，也不依赖系统英语音色。

35,084 条去重录音覆盖 5,709 个词条、16,973 条完整例句，以及分句跟读和
例句中可点读的词。录音由 GitHub Actions 的 40 个批次生成；独立进程运行
Kokoro，先用六条录音检查引擎，再启动全量任务。每条 MP3 都检查时长并
完整解码，结果存入 GitHub Release。生成入口是
`scripts/cloud-audio/generate-full.mjs`，仅允许在 GitHub Actions 运行。

`scripts/cloud-audio/release-lock.json` 固定批次下载地址和 SHA-256。
首次本地预览或静态构建前运行上面的下载命令；它只下载成品音频，校验
全部文件和词库覆盖率，并生成播放索引。GitHub Pages 自动执行这些检查，
不会部署不完整的音频库。修改词库后需要重新生成并更新发布清单。

词库、例句及第三方数据授权说明见 [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md)。

## 云端语音试听

打开网站的 `?audio=preview`，或点击首页的「新语音试听」，可试听 15 条
词库例句。支持自然语速、0.8/1.2 倍速、重播和连续播放。

音频全部由 GitHub Actions 上的 Kokoro 生成；用户浏览器只播放静态 MP3。
修改 `feat/cloud-audio-preview` 分支中的 `scripts/cloud-audio/` 或对应工作流
会触发云端生成，产物保留三天。发布时将产物放入
`public/audio/cloud-preview/`，运行 `node scripts/prepare-cloud-preview.mjs`
校验音频摘要及词库来源并生成文字字幕，再按现有静态构建流程发布。
清单 `manifest.json` 记录生成任务链接、时长和 SHA-256；已发布的 MP3
由网站持续提供，不依赖临时 Actions 产物链接。

## 许可证

代码采用 [MIT](./LICENSE)，其余本项目原创内容采用 [CC BY-SA 4.0](./LICENSES/CC-BY-SA-4.0.txt)。这是按材料类型区分的许可，不是任选其一。详细范围与署名方式见 [LICENSE-CONTENT.md](./LICENSE-CONTENT.md)；第三方内容保留原许可。
