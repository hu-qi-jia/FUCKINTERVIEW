"""面试语音助手 —— 本地开发入口。

- 复用 Pipecat 官方 dev runner（SmallWebRTC、/start、/api/offer 等）
- 额外提供 /api/settings 读写配置
- 用本项目构建的前端替换官方预置 UI（挂载在 /client）
"""

from pathlib import Path

import aiohttp
from fastapi import HTTPException, Request
from fastapi.responses import RedirectResponse
from loguru import logger
from starlette.staticfiles import StaticFiles

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.frames.frames import (
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMRunFrame,
    LLMTextFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker, ProcessorUnusablePolicy
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.processors.aggregators.llm_text_processor import LLMTextProcessor
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
import pipecat.runner.run as runner_run
from pipecat.runner.run import app, main
from pipecat.runner.types import RunnerArguments
from pipecat.runner.utils import create_transport
from pipecat.transports.base_transport import BaseTransport, TransportParams
from pipecat.workers.runner import WorkerRunner

from app.config import load_settings, save_settings
from app.materials import (
    apply_plan,
    create_profile,
    delete_profile,
    find_card,
    get_profile,
    list_profiles,
    open_folder,
    set_data_dir,
    storage_info,
    update_card,
    update_profile,
)
from app.materials_ai import consolidate, generate_card, plan_units
from app.ai import LLMError
from app.providers import build_llm, build_stt, build_tts

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "web" / "client" / "dist"


# --------------------------------------------------------------------------
# 配置接口
# --------------------------------------------------------------------------
@app.get("/api/settings")
async def get_settings():
    return load_settings()


@app.post("/api/settings")
async def update_settings(request: Request):
    try:
        payload = await request.json()
        return save_settings(payload)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"保存配置失败: {e}")


# --------------------------------------------------------------------------
# 面试材料：面试档案（简历 / 岗位描述 / 经历卡）与数据目录
# --------------------------------------------------------------------------
def _profile_or_404(profile_id: str):
    try:
        return get_profile(profile_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="档案不存在")


@app.get("/api/profiles")
async def api_list_profiles():
    return {"profiles": list_profiles()}


@app.post("/api/profiles")
async def api_create_profile(request: Request):
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    name = str(payload.get("name") or "") if isinstance(payload, dict) else ""
    return create_profile(name)


@app.get("/api/profiles/{profile_id}")
async def api_get_profile(profile_id: str):
    return _profile_or_404(profile_id)


@app.patch("/api/profiles/{profile_id}")
async def api_patch_profile(profile_id: str, request: Request):
    payload = await request.json()
    try:
        return update_profile(profile_id, payload)
    except KeyError:
        raise HTTPException(status_code=404, detail="档案不存在")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.delete("/api/profiles/{profile_id}")
async def api_delete_profile(profile_id: str):
    try:
        delete_profile(profile_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="档案不存在")
    return {"ok": True}


@app.post("/api/profiles/{profile_id}/consolidate")
async def api_consolidate(profile_id: str, request: Request):
    profile = _profile_or_404(profile_id)
    payload = await request.json()
    kind = str(payload.get("kind") or "")
    if kind not in ("resume", "jobDescription"):
        raise HTTPException(status_code=400, detail="kind 必须是 resume 或 jobDescription")

    content = str(payload.get("content") or "")
    if not content.strip():
        content = str(profile[kind].get("content") or "")
    if not content.strip():
        raise HTTPException(status_code=400, detail="没有可以整合的内容")

    language = str(payload.get("language") or profile.get("language") or "zh")
    try:
        text = await consolidate(load_settings(), content=content, language=language)
    except LLMError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"content": text}


@app.post("/api/profiles/{profile_id}/skills/plan")
async def api_plan_skills(profile_id: str):
    profile = _profile_or_404(profile_id)
    resume = str(profile["resume"].get("content") or "")
    description = str(profile["jobDescription"].get("content") or "")
    if not resume.strip():
        raise HTTPException(status_code=400, detail="简历为空，无法生成经历卡")
    if not description.strip():
        raise HTTPException(status_code=400, detail="岗位描述为空，无法生成经历卡")

    try:
        units = await plan_units(
            load_settings(),
            resume=resume,
            job_description=description,
            language=str(profile.get("language") or "zh"),
        )
    except LLMError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return apply_plan(profile_id, units)


@app.post("/api/profiles/{profile_id}/skills/{slug}/generate")
async def api_generate_skill(profile_id: str, slug: str):
    profile = _profile_or_404(profile_id)
    try:
        card = find_card(profile_id, slug)
    except KeyError:
        raise HTTPException(status_code=404, detail="经历卡不存在")

    try:
        fields = await generate_card(
            load_settings(),
            unit=card,
            resume=str(profile["resume"].get("content") or ""),
            job_description=str(profile["jobDescription"].get("content") or ""),
            language=str(profile.get("language") or "zh"),
        )
    except LLMError as e:
        update_card(profile_id, slug, {"status": "failed", "error": str(e)})
        raise HTTPException(status_code=502, detail=str(e))

    try:
        return update_card(profile_id, slug, fields)
    except KeyError:
        raise HTTPException(status_code=404, detail="经历卡不存在")


@app.get("/api/storage")
async def api_storage():
    return storage_info()


@app.put("/api/storage")
async def api_set_storage(request: Request):
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="请求体必须是 JSON 对象")
    try:
        return set_data_dir(
            str(payload.get("dataDir") or ""),
            migrate=bool(payload.get("migrate", True)),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except OSError as e:
        raise HTTPException(status_code=400, detail=f"切换目录失败：{e}")


@app.post("/api/storage/open")
async def api_open_storage():
    try:
        open_folder()
    except OSError as e:
        raise HTTPException(status_code=400, detail=f"打开目录失败：{e}")
    return {"ok": True}


# --------------------------------------------------------------------------
# 前端：用本项目构建的界面替换官方预置 UI
#
# Runner 在 main() 里调用 _setup_frontend_routes(app) 挂载官方 UI，
# 这里替换该函数，让同一路径 /client 指向本项目的构建产物。
# --------------------------------------------------------------------------
_original_setup_frontend = runner_run._setup_frontend_routes


def _setup_project_frontend(fastapi_app):
    if not DIST.is_dir():
        logger.warning(f"未找到前端构建产物 {DIST}，继续使用官方预置 UI")
        _original_setup_frontend(fastapi_app)
        return

    fastapi_app.mount(
        "/client", StaticFiles(directory=str(DIST), html=True), name="interview-ui"
    )

    @fastapi_app.get("/", include_in_schema=False)
    async def root_redirect():
        return RedirectResponse(url="/client/")


runner_run._setup_frontend_routes = _setup_project_frontend


# --------------------------------------------------------------------------
# 语音 pipeline
# --------------------------------------------------------------------------
transport_params = {
    "webrtc": lambda: TransportParams(
        audio_in_enabled=True,
        audio_out_enabled=True,
    ),
}


class TextOnlyOutput(FrameProcessor):
    """把 LLM 的输出标记为「不朗读」。

    实时面试没有 TTS，所以每个输出帧都必须带 skip_tts=True；否则
    RTVIObserver 会等一个永远不会出现的 BotStartedSpeakingFrame，
    聚合文本也就发不到前端。放在 LLM 之后、LLMTextProcessor 之前。
    """

    async def process_frame(self, frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        if isinstance(
            frame,
            (LLMTextFrame, LLMFullResponseStartFrame, LLMFullResponseEndFrame),
        ):
            frame.skip_tts = True
        await self.push_frame(frame, direction)


async def run_bot(transport: BaseTransport, runner_args: RunnerArguments):
    settings = load_settings()
    body = runner_args.body if isinstance(runner_args.body, dict) else {}
    mode = str(body.get("mode", "mock")).lower()
    if mode not in ("live", "listen", "mock"):
        mode = "mock"

    logger.info(
        f"Starting bot mode={mode} with "
        f"ASR={settings['asr'].get('provider')}/{settings['asr'].get('model')}, "
        f"LLM={settings['llm'].get('provider')}/{settings['llm'].get('model')}, "
        f"TTS={settings['tts'].get('provider')}/{settings['tts'].get('model')}"
    )

    async with aiohttp.ClientSession() as session:
        stt = build_stt(settings["asr"])

        # live 模式用不到 TTS：答案只以文本形式推给前端。
        # listen 是实时面试的第二路（麦克风），只做转写。
        llm = build_llm(settings["llm"]) if mode != "listen" else None
        tts = build_tts(settings["tts"], session) if mode == "mock" else None

        context = LLMContext()
        processors = [transport.input(), stt]

        if mode != "listen":
            user_aggregator, assistant_aggregator = LLMContextAggregatorPair(
                context,
                user_params=LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer()),
            )
            processors += [user_aggregator, llm]
            # 原来的 TTS 槽位：mock 合成语音，live 只把文本转成
            # AggregatedTextFrame，由 RTVIObserver 作为 BotOutput 发给前端。
            if mode == "mock":
                processors.append(tts)
            else:
                processors.append(TextOnlyOutput())
                processors.append(LLMTextProcessor())
            processors += [transport.output(), assistant_aggregator]
        else:
            # 分段 STT 靠 VAD 帧切句，而 VAD 由用户聚合器运行；只听不答的
            # 第二路也必须带上它，否则一段转写都不会产生。
            user_aggregator, _assistant_aggregator = LLMContextAggregatorPair(
                context,
                user_params=LLMUserAggregatorParams(vad_analyzer=SileroVADAnalyzer()),
            )
            processors += [user_aggregator, transport.output()]

        pipeline = Pipeline(processors)

        worker = PipelineWorker(
            pipeline,
            params=PipelineParams(
                enable_metrics=True,
                enable_usage_metrics=True,
            ),
            idle_timeout_secs=runner_args.pipeline_idle_timeout_secs,
            processor_unusable_policy=ProcessorUnusablePolicy.END,
        )

        runner = WorkerRunner(handle_sigint=runner_args.handle_sigint)
        await runner.add_workers(worker)

        @transport.event_handler("on_client_connected")
        async def on_client_connected(transport, client):
            logger.info("Client connected")
            if mode == "mock":
                context.add_message(
                    {"role": "developer", "content": "请先向候选人简短问好，然后开始面试。"}
                )
                await worker.queue_frames([LLMRunFrame()])

        @transport.event_handler("on_client_disconnected")
        async def on_client_disconnected(transport, client):
            logger.info("Client disconnected")
            await runner.cancel()

        await runner.run()


async def bot(runner_args: RunnerArguments):
    """Runner 每个会话调用一次。"""
    try:
        transport = await create_transport(runner_args, transport_params)
        await run_bot(transport, runner_args)
    except ValueError as e:
        logger.error(f"配置错误: {e}")
        raise


if __name__ == "__main__":
    main()
