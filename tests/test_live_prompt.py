"""实时面试的系统提示词：候选人视角、多问全答、追问接续，档案按预算裁剪。

提示词是实时面试的全部性格。它悄悄变了，症状是面试表现不对但日志全绿，
所以这里把几条硬规则钉住。
"""

from __future__ import annotations

from app.materials_ai import build_live_system_prompt


def test_language_is_substituted_not_left_as_placeholder():
    prompt = build_live_system_prompt({"language": "zh"})
    assert "{language}" not in prompt
    assert "用简体中文回答" in prompt

    prompt = build_live_system_prompt({"language": "en"})
    assert "用English回答" in prompt


def test_prompt_demands_every_question_be_answered():
    """一次问了几个就答几个，不许只答第一个。"""
    prompt = build_live_system_prompt(None)
    assert "一个都不许漏" in prompt
    assert "后面的问没轮到" in prompt


def test_prompt_tells_how_to_handle_a_rapid_followup():
    """追问要接住上一答，不要重复、不要自相矛盾。"""
    prompt = build_live_system_prompt(None)
    assert "接住你上一条回答" in prompt
    assert "不重复、不前后矛盾" in prompt
    assert "上一问里没答到的要点在这一问里补上" in prompt


def test_prompt_splits_facts_from_general_knowledge():
    """经历事实只认 profile；原理方案放开，但相撞时 profile 赢。"""
    prompt = build_live_system_prompt(None)
    assert "只使用 <profile> 里确认过的内容" in prompt
    assert "用你自己的知识回答" in prompt
    assert "两类撞上时以 <profile> 为准" in prompt
    # 举例要落在 profile 的栈上，否则通用答案会跟经历对不上。
    assert "举例一律落在 <profile> 里出现过的技术栈上" in prompt


def test_prompt_sets_length_by_question_type():
    """项目经历走 STAR 分点，技术题展开，其余保持短答。"""
    prompt = build_live_system_prompt(None)
    assert "STAR" in prompt
    assert "8–12 句" in prompt
    assert "3–6 句" in prompt
    # 分点用换行就行，不能再要求 Markdown——界面是纯文本。
    assert "可以用换行分点" in prompt


def test_prompt_allows_an_opinion_when_asked():
    prompt = build_live_system_prompt(None)
    assert "给有依据的判断" in prompt
    assert "不要空喊口号" in prompt


def test_prompt_still_forbids_making_things_up():
    prompt = build_live_system_prompt(None)
    assert "不要编造" in prompt
    assert "不要 Markdown" in prompt


def test_empty_profile_says_so_instead_of_inventing():
    prompt = build_live_system_prompt(None)
    assert "<profile>" in prompt
    assert "不要编造任何经历" in prompt


def test_profile_facts_are_included():
    prompt = build_live_system_prompt(
        {
            "language": "zh",
            "resume": {"content": "五年后端"},
            "jobDescription": {"content": "招资深后端"},
            "cards": [
                {
                    "name": "订单中台",
                    "description": "把下单链路收拢",
                    "status": "ready",
                    "position": 0,
                    "body": {"facts": "峰值日订单 40 万"},
                },
                # 没生成完的卡不能进提示词，免得拿半截内容去面试。
                {
                    "name": "半成品卡",
                    "description": "还在生成",
                    "status": "generating",
                    "position": 1,
                    "body": {"facts": "不该出现"},
                },
            ],
        }
    )
    assert "五年后端" in prompt
    assert "招资深后端" in prompt
    assert "峰值日订单 40 万" in prompt
    assert "半成品卡" not in prompt
    assert "不该出现" not in prompt


def test_glossary_goes_last_to_protect_prefix_cache():
    """术语段比档案变得勤，垫在最后才不会把前面整段挤出前缀缓存。"""
    prompt = build_live_system_prompt(
        {"language": "zh", "resume": {"content": "简历"}}, glossary="幂等键：同一请求只生效一次。"
    )
    assert prompt.rstrip().endswith("幂等键：同一请求只生效一次。")


def test_huge_cards_are_dropped_rather_than_blowing_the_budget():
    prompt = build_live_system_prompt(
        {
            "language": "zh",
            "cards": [
                {
                    "name": f"卡 {i}",
                    "description": "描" * 600,
                    "status": "ready",
                    "position": i,
                    "body": {"facts": "事" * 700, "defense": "守" * 900},
                }
                for i in range(20)
            ],
        }
    )
    assert len(prompt) < 20000
    # 预算用完后要停，不能无限往里塞。
    assert prompt.count("### 卡 ") < 20
