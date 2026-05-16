from __future__ import annotations

import unittest

from cairn.dispatcher.contracts import validate_summary_payload
from cairn.dispatcher.prompting import load_prompt


class SummaryContractTests(unittest.TestCase):
    def test_summary_title_longer_than_twenty_characters_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "20 characters"):
            validate_summary_payload(
                {"accepted": True, "data": {"title": "一二三四五六七八九十一二三四五六七八九十一"}}
            )

    def test_summary_title_whitespace_is_normalized_before_length_check(self) -> None:
        kind, title = validate_summary_payload(
            {"accepted": True, "data": {"title": "   Alpha   Beta   Gamma   "}}
        )

        self.assertEqual(kind, "title")
        self.assertEqual(title, "Alpha Beta Gamma")
        self.assertLessEqual(len(title), 20)

    def test_summary_title_rejects_raw_description_prefix(self) -> None:
        description = "模型输出冗长原文导致标题不可读，需要重新生成语义摘要"

        with self.assertRaisesRegex(ValueError, "semantic summary"):
            validate_summary_payload(
                {"accepted": True, "data": {"title": "模型输出冗长原文导致标题不可读"}},
                source_description=description,
            )

    def test_summary_title_rejects_incomplete_twenty_character_phrase(self) -> None:
        with self.assertRaisesRegex(ValueError, "incomplete"):
            validate_summary_payload(
                {"accepted": True, "data": {"title": "仅返回二十字但语义残缺的"}}
            )

    def test_summary_title_accepts_semantic_twenty_character_title(self) -> None:
        kind, title = validate_summary_payload(
            {"accepted": True, "data": {"title": "摘要拒绝原文截断"}},
            source_description="模型输出冗长原文导致标题不可读，需要重新生成语义摘要",
        )

        self.assertEqual(kind, "title")
        self.assertEqual(title, "摘要拒绝原文截断")

    def test_summary_prompts_require_semantic_compression_not_prefix_copy(self) -> None:
        for group in ("default", "zh", "mock"):
            with self.subTest(group=group):
                prompt = load_prompt(group, "summary.md")
                self.assertIn("20", prompt)
                self.assertIn("主语", prompt)
                self.assertIn("动作", prompt)
                self.assertIn("禁止直接截取原文前缀", prompt)


if __name__ == "__main__":
    unittest.main()
