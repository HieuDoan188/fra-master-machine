"""Token compression - shrinks context before sending to the model."""

import re


class TokenCompressor:
    def compress(self, text: str, max_chars: int = 4000) -> str:
        if len(text) <= max_chars:
            return text
        head = text[: max_chars // 2]
        tail = text[-max_chars // 4 :]
        return f"{head}\n...[compressed {len(text) - max_chars * 3 // 4} chars]...\n{tail}"

    def strip_noise(self, text: str) -> str:
        text = re.sub(r"\s+", " ", text)
        return text.strip()