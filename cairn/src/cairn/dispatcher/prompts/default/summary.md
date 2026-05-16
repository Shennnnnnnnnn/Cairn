# Task
Compress the {kind} description below into a readable Chinese short title for a graph label.

# Output
Return only valid JSON:
```json
{"accepted": true, "data": {"title": "..."}}
```

# Rules
- Do semantic compression yourself. Extract 主语 + 动作/结论 (the subject plus its key action, result, or conclusion).
- The title must carry the real content. Prefer a compact Chinese phrase such as `摘要拒绝原文截断`.
- 禁止直接截取原文前缀. Do not copy the beginning of the description as the title.
- Do not return an unfinished phrase, dangling clause, or raw long sentence.
- Hard limit: the title must be 20 characters or fewer.
- For Chinese/Japanese/Korean text, count each written character as 1 character.
- If your first title is longer than 20 characters, rewrite it shorter before returning JSON.
- Do not include punctuation, explanations, prefixes, or Markdown.

# Object
id: {id}

# Description
{description}
