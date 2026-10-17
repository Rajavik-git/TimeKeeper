"""Create the static emulator catalogue from fictional demo documents.

Only file metadata and a short textual preview enter the browser build. The source
DOCX/PDF/EML files remain outside Vite's public directory.
"""
import json
import re
import subprocess
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZipFile

root = Path(__file__).resolve().parents[1]
records = []
for path in sorted((root / 'demo/documents').rglob('*')):
    if not path.is_file():
        continue
    if path.suffix == '.docx':
        with ZipFile(path) as archive:
            document = ET.fromstring(archive.read('word/document.xml'))
        lines = []
        for paragraph in document.iter():
            if not paragraph.tag.endswith('}p'):
                continue
            value = ''.join('\n' if element.tag.endswith('}br') else
                            '    ' if element.tag.endswith('}tab') else element.text or ''
                            for element in paragraph.iter()
                            if element.tag.endswith('}t') or element.tag.endswith('}tab')
                            or element.tag.endswith('}br')).strip()
            lines.extend(segment.strip() for segment in value.splitlines() if segment.strip())
    elif path.suffix == '.pdf':
        output = subprocess.check_output(['pdftotext', '-layout', str(path), '-'], text=True)
        lines = [line.strip() for line in output.splitlines() if line.strip()]
    elif path.suffix == '.eml':
        lines = [line.strip() for line in path.read_text().splitlines() if line.strip()]
    else:
        continue
    preview = [re.sub(r'\[[^]]+\]', '—', line) for line in lines[:20]]
    records.append({'folder': path.parent.name, 'name': path.name, 'type': path.suffix[1:],
                    'size': path.stat().st_size, 'modified': 'Oct 16, 2026', 'preview': preview})
output = root / 'src/frontend/features/emulator/documents.json'
output.write_text(json.dumps(records, indent=2, ensure_ascii=False) + '\n')
print(f'Wrote {len(records)} fictional documents to {output.relative_to(root)}')
