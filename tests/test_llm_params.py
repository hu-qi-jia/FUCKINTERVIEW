"""LLM 采样参数：配置里的温度要真的进到服务的 settings，不填就整个不传。

这条链路横跨 ``app/config.py``（默认值）和 ``app/providers.py``（传参），
只测一头会漏：配置写了、providers 没接，或者接了又被 NOT_GIVEN 冲掉，
都只有把服务真建出来看 settings 才能发现。
"""

from __future__ import annotations

import app.config as config
import app.providers as providers
from app.ai import _sampling_extras


def _section(**overrides):
    section = {
        "provider": "openai_compatible",
        "api_key": "sk-test",
        "base_url": "",
        "model": "deepseek-flash",
    }
    section.update(overrides)
    return section


def test_default_temperature_is_08():
    assert config.DEFAULT_SETTINGS["llm"]["temperature"] == 0.8


def test_temperature_reaches_the_service_settings():
    llm = providers.build_llm(_section(temperature=0.3))
    assert float(llm._settings.temperature) == 0.3


def test_temperature_reaches_the_service_settings_for_qwen():
    llm = providers.build_llm(_section(provider="qwen", temperature=0.3))
    assert float(llm._settings.temperature) == 0.3


def test_omitted_temperature_stays_unset():
    """不填就走供应商默认：不能被 0 或 None 之类悄悄代劳。"""
    llm = providers.build_llm(_section())
    # openai 的 NOT_GIVEN 不是数字，`float()` 必炸；这正是我们要的。
    try:
        float(llm._settings.temperature)
    except (TypeError, ValueError):
        pass
    else:
        raise AssertionError(f"不该带 temperature，实际是 {llm._settings.temperature!r}")


def test_blank_temperature_is_not_sent():
    """设置页里清空输入框会存成空串，同样当作「不传」。"""
    llm = providers.build_llm(_section(temperature=""))
    try:
        float(llm._settings.temperature)
    except (TypeError, ValueError):
        pass
    else:
        raise AssertionError(f"不该带 temperature，实际是 {llm._settings.temperature!r}")


def test_thinking_switch_and_temperature_are_independent():
    """关思考不能把温度一起带走，两者是两件事。"""
    llm = providers.build_llm(_section(temperature=0.8, disable_thinking=True))
    assert float(llm._settings.temperature) == 0.8
    assert llm._settings.extra == {"reasoning_effort": "none"}

    llm = providers.build_llm(_section(temperature=0.8, disable_thinking=False))
    assert float(llm._settings.temperature) == 0.8
    assert llm._settings.extra == {}


def test_generation_path_reads_the_same_temperature():
    """语音管线和生成管线共用 llm.temperature，别各设各的。"""
    assert _sampling_extras({"temperature": 0.8}) == {"temperature": 0.8}
    assert _sampling_extras({"temperature": ""}) == {}
    assert _sampling_extras({}) == {}
    # True 是 bool，会被当成 int 混进去，得挡住。
    assert _sampling_extras({"temperature": True}) == {}
