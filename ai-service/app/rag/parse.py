"""从常见办公文件提取纯文本。"""

from __future__ import annotations

from pathlib import Path


def extract_text(path: Path, file_format: str | None = None) -> str:
    """
    返回提取的文本；无法解析时返回空串（不抛）。
    支持：txt、pdf、docx；其他格式返回文件名说明占位。
    """
    fmt = (file_format or path.suffix.lstrip(".")).lower()
    try:
        if fmt in ("txt", "md", "csv", "log"):
            return path.read_text(encoding="utf-8", errors="ignore")
        if fmt == "pdf":
            return _pdf(path)
        if fmt == "docx":
            return _docx(path)
        if fmt in ("doc", "xls", "xlsx", "png", "jpg", "jpeg", "gif", "bmp", "dwg", "dxf", "zip", "rar"):
            # 扫描件/二进制：仅元数据由调用方拼入
            return ""
        return path.read_text(encoding="utf-8", errors="ignore")
    except Exception:  # noqa: BLE001
        return ""


def _pdf(path: Path) -> str:
    try:
        from pypdf import PdfReader
    except ImportError:
        return ""
    reader = PdfReader(str(path))
    parts: list[str] = []
    for page in reader.pages[:80]:  # 上限防过大
        try:
            t = page.extract_text() or ""
        except Exception:  # noqa: BLE001
            t = ""
        if t.strip():
            parts.append(t)
    return "\n".join(parts)


def _docx(path: Path) -> str:
    try:
        import docx  # python-docx
    except ImportError:
        return ""
    doc = docx.Document(str(path))
    return "\n".join(p.text for p in doc.paragraphs if p.text and p.text.strip())
