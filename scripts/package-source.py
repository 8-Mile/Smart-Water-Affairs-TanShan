from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import os
root=Path(__file__).resolve().parents[1]
output=root/'artifacts'/'唐港智慧水务_DEMO_首批源码.zip'
output.parent.mkdir(exist_ok=True)
allowed={'apps','packages','docs','fixtures','scripts','tests'}
root_files={'README.md','package.json','pnpm-lock.yaml','pnpm-workspace.yaml','playwright.config.ts','eslint.config.mjs','docker-compose.yml','.env.example','.gitignore','.npmrc'}
excluded={'node_modules','dist','.data','.git','test-results','playwright-report','__pycache__'}
paths=[]
for base,dirs,files in os.walk(root,followlinks=False):
    directory=Path(base)
    dirs[:]=[d for d in dirs if d not in excluded and (directory!=root or d in allowed)]
    for name in files:
        path=directory/name
        if directory==root and name not in root_files: continue
        if name.startswith('.env') and name!='.env.example': continue
        if name.endswith(('.pyc','.tsbuildinfo')) or path.is_symlink(): continue
        paths.append(path)
with ZipFile(output,'w',ZIP_DEFLATED) as z:
    for path in sorted(paths): z.write(path,path.relative_to(root))
with ZipFile(output) as z:
    assert z.testzip() is None
    assert all(not (set(Path(n).parts)&excluded) for n in z.namelist())
    assert not any(Path(n).name=='.env' for n in z.namelist())
print(f'{output}\n{len(paths)} files; {output.stat().st_size} bytes; archive validated')
