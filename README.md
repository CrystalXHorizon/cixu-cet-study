# 词序

面向大一和英语基础较弱学习者的四六级背词网站。根据考试日期与高考英语成绩安排新词量，通过整句听力、双语理解和间隔复习记忆单词。

## 本地运行

```bash
npm install
npm run dev
```

## 静态构建

```bash
npm run build
```

静态文件生成在 `dist`。仓库中的 GitHub Actions 工作流会在 `main` 分支更新后自动部署 GitHub Pages。

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
