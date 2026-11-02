# 内置的 Pipecat 源码

这个目录是项目运行时实际使用的 Pipecat 源码，随仓库一起提交，不用再单独
`git clone` 上游，干净克隆后 `pip install -r requirements.txt` 就能装好。

- 上游仓库：<https://github.com/pipecat-ai/pipecat>
- 基线 commit：`91f7331df812f0556874031aa49ffb71a4bf2cb8`
  （2026-10-27，Merge pull request #6389 from ninglinLiu/fix/env-example-gradium）
- 本地精简 commit：`2bdd0b954e62f7e1968300e8522f851d38b1b13a`
  （只删除本项目用不到的服务、测试与 uv.lock，没有修改上游逻辑）
- 本项目额外的小改动（减少模块级依赖，纯文本 / 纯音频链路更快）：
  - `utils/image.py`、`transports/base_output.py`、`evals/serializer.py`
    里用到 Pillow 的地方改成函数内延迟导入，只有真正处理图片时才加载。
    Pillow 仍然会随安装包发布（fastembed 的 `common/types.py` 在顶层
    导入了它），但启动和检索不受影响。
- 许可证：BSD 2-Clause，见同目录 `LICENSE`

## 升级步骤

1. 从上游拉取目标版本，确认与 `server.py` / `app/` 的接口兼容；
2. 只保留 `src/pipecat/` 里本项目用到的部分（可参考基线精简 commit 的删除范围）；
3. 更新上面的基线 commit；
4. 跑一遍 `python -m pytest` 和一次实时面试冒烟。
