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

## 许可证

代码采用 [MIT](./LICENSE)，其余本项目原创内容采用 [CC BY-SA 4.0](./LICENSES/CC-BY-SA-4.0.txt)。这是按材料类型区分的许可，不是任选其一。详细范围与署名方式见 [LICENSE-CONTENT.md](./LICENSE-CONTENT.md)；第三方内容保留原许可。
