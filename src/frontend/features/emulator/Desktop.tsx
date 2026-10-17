import { useEffect, useRef, useState, type PointerEvent } from 'react';
import documents from './documents.json';
import './Desktop.css';

type DemoFile = (typeof documents)[number];
type WindowType = 'explorer' | 'file' | 'timekeeper';
type DesktopWindow = { id: string; type: WindowType; file?: DemoFile; x: number; y: number; z: number; minimized: boolean };
const folders = [
  '2025-031 Dawson v Martin', '2026-004 Divorce - Bennett',
  '2026-009 Commercial lease - Dawson', '2026-012 Bylaws - Lumen Inc',
  '2026-015 Shareholders agreement - Lumen Inc', 'Unsorted',
];
const demoSteps = [
  ['Open the Dawson brief', '2025-031 Opposition Brief v3.docx'],
  ['Switch to the Lumen memo', '2026-015 Memo on right of first refusal.docx'],
  ['Open the research note', 'Research - notice of appeal deadline for family court orders.docx'],
] as const;
const fileApp = (file: DemoFile) => file.type === 'docx' ? 'Word' : file.type === 'pdf' ? 'Adobe Acrobat' : 'Outlook';
const fileTitle = (file: DemoFile) => `${file.name} - ${file.type === 'pdf' ? 'Acrobat' : fileApp(file)}`;
const fileKind = (file: DemoFile) => file.type === 'docx' ? 'W' : file.type === 'pdf' ? 'PDF' : '✉';
const fileSize = (size: number) => `${Math.max(1, Math.round(size / 1024))} KB`;
function FolderIcon({ small = false }: { small?: boolean }) {
  return <svg className={small ? 'em-folder small' : 'em-folder'} viewBox="0 0 48 48" aria-hidden="true"><path fill="#e8b950" d="M4 11a4 4 0 0 1 4-4h12l5 5h15a4 4 0 0 1 4 4v25H4z"/><path fill="#f6cf6b" d="M4 19a4 4 0 0 1 4-4h32a4 4 0 0 1 4 4v20a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z"/></svg>;
}
function FileIcon({ file, small = false }: { file: DemoFile; small?: boolean }) {
  return <span className={`em-file-icon ${file.type}${small ? ' small' : ''}`} aria-hidden="true">{fileKind(file)}</span>;
}
function WinMark() {
  return <span className="em-winmark" aria-hidden="true"><i/><i/><i/><i/></span>;
}
function DocumentPage({ file }: { file: DemoFile }) {
  if (file.type === 'eml') {
    const headers = file.preview.filter(line => /^(From|To|Subject|Date):/.test(line));
    const body = file.preview.filter(line => !/^(From|To|Subject|Date|MIME-Version|Content-Type):/.test(line));
    return <div className="em-email"><h2>{file.name.replace(/\.eml$/, '')}</h2><div className="em-email-headers">{headers.map((line,i)=><p key={i}>{line}</p>)}</div><div className="em-email-body">{body.map((line,i)=><p key={i}>{line}</p>)}</div></div>;
  }
  return <div className="em-paper"><div className="em-paper-top">Morgan Law Office <span>Confidential · Fictional demo</span></div>{file.preview.map((line,i)=>{
    const prominent = line.length > 24 && line.length < 100 && (line === line.toUpperCase() || /^(MEMORANDUM|RESEARCH NOTE|BYLAWS)/.test(line));
    return prominent ? <h2 key={i}>{line}</h2> : <p key={i}>{line}</p>;
  })}</div>;
}

export function Desktop() {
  const [windows,setWindows] = useState<DesktopWindow[]>([{id:'explorer',type:'explorer',x:90,y:108,z:2,minimized:false}]);
  const [folder,setFolder] = useState(folders[0]);
  const [maxZ,setMaxZ] = useState(2);
  const zCounter = useRef(2);
  const [startOpen,setStartOpen] = useState(false);
  const [pillHeight,setPillHeight] = useState(38);
  const pill = useRef<HTMLIFrameElement>(null);
  const lastFileFocus = useRef('');
  const drag = useRef<{id:string;startX:number;startY:number;originX:number;originY:number}|null>(null);
  const nextZ = () => { const z=++zCounter.current;setMaxZ(z);return z; };
  const focusWindow = (id: string) => {
    const z=nextZ();
    setWindows(items=>items.map(item=>item.id===id?{...item,z,minimized:false}:item));
  };
  const openExplorer = (nextFolder?: string) => {
    if(nextFolder)setFolder(nextFolder);
    if(windows.some(item=>item.id==='explorer'))focusWindow('explorer');
    else {const z=nextZ();setWindows(items=>[...items,{id:'explorer',type:'explorer',x:90,y:108,z,minimized:false}]);}
  };
  const openTimeKeeper = () => {
    if(windows.some(item=>item.id==='timekeeper'))focusWindow('timekeeper');
    else {const z=nextZ();setWindows(items=>[...items,{id:'timekeeper',type:'timekeeper',x:300,y:105,z,minimized:false}]);}
  };
  const openFile = (file: DemoFile) => {
    const id = `file:${file.name}`;
    if(windows.some(item=>item.id===id))focusWindow(id);
    else {const z=nextZ();setWindows(items=>[...items,{id,type:'file',file,x:340,y:125,z,minimized:false}]);}
    if(lastFileFocus.current !== id) {
      lastFileFocus.current=id;
      pill.current?.contentWindow?.postMessage({type:'timekeeper:active-window-changed',windowTitle:fileTitle(file),appName:fileApp(file)},window.location.origin);
    }
  };
  const focus = (item: DesktopWindow) => {
    focusWindow(item.id);
    if(item.type==='file'&&item.file&&lastFileFocus.current!==item.id){
      lastFileFocus.current=item.id;
      pill.current?.contentWindow?.postMessage({type:'timekeeper:active-window-changed',windowTitle:fileTitle(item.file),appName:fileApp(item.file)},window.location.origin);
    }
  };
  const minimize = (id:string) => setWindows(items=>items.map(item=>item.id===id?{...item,minimized:true}:item));
  const close = (id:string) => setWindows(items=>items.filter(item=>item.id!==id));
  const beginDrag = (event:PointerEvent<HTMLElement>,item:DesktopWindow) => {
    if((event.target as HTMLElement).closest('button'))return;
    drag.current={id:item.id,startX:event.clientX,startY:event.clientY,originX:item.x,originY:item.y};
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event:PointerEvent<HTMLElement>) => {
    const value=drag.current;
    if(!value)return;
    const zoom=Number.parseFloat(getComputedStyle(document.documentElement).zoom)||1;
    const frame=event.currentTarget.parentElement as HTMLElement;
    const desktop=frame.parentElement as HTMLElement;
    const x=Math.max(0,Math.min(desktop.clientWidth-frame.offsetWidth,value.originX+(event.clientX-value.startX)/zoom));
    const y=Math.max(0,Math.min(desktop.clientHeight-frame.offsetHeight-53,value.originY+(event.clientY-value.startY)/zoom));
    setWindows(items=>items.map(item=>item.id===value.id?{...item,x,y}:item));
  };
  useEffect(()=>{
    const onMessage=(event:MessageEvent)=>{
      if(event.origin!==window.location.origin||event.source!==pill.current?.contentWindow)return;
      if(event.data?.type==='timekeeper:open-app')openTimeKeeper();
      if(event.data?.type==='timekeeper:pill-height'&&Number.isFinite(event.data.height)&&event.data.height>=38&&event.data.height<=900)
        setPillHeight(Math.ceil(event.data.height));
    };
    window.addEventListener('message',onMessage);
    return()=>window.removeEventListener('message',onMessage);
  });
  useEffect(()=>{
    const syncTheme=()=>pill.current?.contentWindow?.postMessage({type:'timekeeper:theme',theme:document.documentElement.dataset.theme??'auto'},window.location.origin);
    const observer=new MutationObserver(syncTheme);
    observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    syncTheme();
    return()=>observer.disconnect();
  },[]);
  const displayed = windows.filter(item=>!item.minimized);
  const sorted = [...windows].sort((a,b)=>a.z-b.z);
  return <section className="em-desktop" aria-label="Windows desktop emulator">
    <div className="em-wallpaper" aria-hidden="true"><span className="em-ribbon one"/><span className="em-ribbon two"/><span className="em-ribbon three"/></div>
    <div className="em-icons">
      <button className="em-desktop-icon" onClick={()=>{openExplorer();setStartOpen(false)}}><FolderIcon/><span>Cases</span></button>
      <button className="em-desktop-icon" onClick={openTimeKeeper}><span className="em-app-icon">T<span>✦</span></span><span>TimeKeeper</span></button>
    </div>
    <aside className="em-script" aria-label="Demo script"><strong>Demo script</strong><span>Follow a lawyer's workday</span>
      {demoSteps.map(([label,name],i)=><button key={name} onClick={()=>{const file=documents.find(item=>item.name===name);if(file){openExplorer(file.folder);openFile(file);}}}><b>{i+1}</b>{label}</button>)}
      <button onClick={openTimeKeeper}><b>4</b>Open TimeKeeper and validate</button>
    </aside>
    {displayed.map(item=><section key={item.id} className={`em-window ${item.type}${item.z===maxZ?' active':''}`} style={{left:item.x,top:item.y,zIndex:item.z}} onPointerDown={()=>focus(item)} aria-label={item.type==='file'?fileTitle(item.file!):item.type==='explorer'?'File Explorer':'TimeKeeper app'}>
      <header className="em-titlebar" onPointerDown={event=>beginDrag(event,item)} onPointerMove={moveDrag} onPointerUp={()=>{drag.current=null}}>
        {item.type==='explorer'?<FolderIcon small/>:item.type==='file'?<FileIcon file={item.file!} small/>:<span className="em-app-icon small">T</span>}
        <span className="em-window-title">{item.type==='explorer'?'File Explorer':item.type==='file'?fileTitle(item.file!):'TimeKeeper'}</span>
        <div className="em-window-controls"><button title="Minimize" aria-label="Minimize window" onClick={()=>minimize(item.id)}>─</button><button title="Close" aria-label="Close window" onClick={()=>close(item.id)}>×</button></div>
      </header>
      {item.type==='explorer'&&<div className="em-explorer">
        <div className="em-explorer-toolbar"><span className="em-crumb">This PC <b>›</b> Cases <b>›</b> {folder}</span><span className="em-search">⌕ &nbsp; Search in {folder}</span></div>
        <div className="em-explorer-body"><nav aria-label="Case folders"><span className="em-nav-title">Quick access</span><button className="selected" onClick={()=>openExplorer()}><FolderIcon small/> Cases</button><span className="em-nav-title">Folders</span>{folders.map(name=><button key={name} className={folder===name?'selected':''} onClick={()=>setFolder(name)} title={name}><FolderIcon small/>{name}</button>)}</nav>
          <div className="em-file-list"><div className="em-list-heading"><strong>{folder}</strong><span>{documents.filter(file=>file.folder===folder).length} items</span></div><div className="em-column-head"><span>Name</span><span>Date modified</span><span>Type</span><span>Size</span></div>{documents.filter(file=>file.folder===folder).map(file=><button key={file.name} className="em-file-row" onDoubleClick={()=>openFile(file)} title={`Double-click to open ${file.name}`}><span><FileIcon file={file} small/>{file.name}</span><span>{file.modified}</span><span>{file.type==='docx'?'Word document':file.type==='pdf'?'PDF document':'Email message'}</span><span>{fileSize(file.size)}</span></button>)}</div>
        </div><div className="em-explorer-status">{documents.filter(file=>file.folder===folder).length} items · Double-click a document to open it</div>
      </div>}
      {item.type==='file'&&item.file&&<div className={`em-document-app ${item.file.type}`}><div className="em-document-toolbar"><span>{item.file.type==='docx'?'Home　 Insert　 Layout　 Review　 View':item.file.type==='pdf'?'All tools　 Edit　 Convert　 Sign':'Home　 Send / Receive　 View'}</span><span>{item.file.type==='pdf'?'100%　▾':'Saved locally'}</span></div><div className="em-document-scroll"><DocumentPage file={item.file}/></div><div className="em-document-status">{item.file.type==='eml'?'Message': 'Page 1 of 1'} <span>{item.file.type==='docx'?'English (United States)':item.file.type==='pdf'?'100%':'Fictional demo message'}</span></div></div>}
      {item.type==='timekeeper'&&<iframe className="em-app-frame" title="TimeKeeper inside the desktop" src="/?embedded=1"/>}
    </section>)}
    <iframe ref={pill} className="em-pill-frame" style={{height:pillHeight}} onLoad={()=>pill.current?.contentWindow?.postMessage({type:'timekeeper:theme',theme:document.documentElement.dataset.theme??'auto'},window.location.origin)} title="TimeKeeper desk pill" src="/pill.html?emulator=1"/>
    {startOpen&&<div className="em-start-menu"><strong>Good morning, Claire</strong><button onClick={()=>{openExplorer();setStartOpen(false)}}><FolderIcon small/> File Explorer</button><button onClick={()=>{openTimeKeeper();setStartOpen(false)}}><span className="em-app-icon small">T</span> TimeKeeper</button></div>}
    <footer className="em-taskbar"><button title="Start" aria-label="Start menu" onClick={()=>setStartOpen(!startOpen)}><WinMark/></button><button title="File Explorer" aria-label="File Explorer" onClick={()=>openExplorer()}><FolderIcon small/></button><button title="Word" aria-label="Word" onClick={()=>{const file=sorted.filter(value=>value.file?.type==='docx').at(-1)?.file??documents.find(value=>value.name===demoSteps[0][1]);if(file)openFile(file)}}><span className="em-file-icon docx small">W</span></button><button title="Acrobat" aria-label="Acrobat" onClick={()=>{const file=sorted.filter(value=>value.file?.type==='pdf').at(-1)?.file??documents.find(value=>value.type==='pdf');if(file)openFile(file)}}><span className="em-file-icon pdf small">PDF</span></button><button title="Outlook" aria-label="Outlook" onClick={()=>{const file=sorted.filter(value=>value.file?.type==='eml').at(-1)?.file??documents.find(value=>value.type==='eml');if(file)openFile(file)}}><span className="em-file-icon eml small">✉</span></button>
      <div className="em-task-open">{sorted.map(item=><button key={item.id} className={item.minimized?'minimized':''} title={item.type==='file'?item.file?.name:item.type} onClick={()=>item.minimized?focus(item):minimize(item.id)}>{item.type==='explorer'?<FolderIcon small/>:item.type==='file'?<FileIcon file={item.file!} small/>:<span className="em-app-icon small">T</span>}</button>)}</div>
      <div className="em-tray"><button aria-label="Open TimeKeeper from tray" title="TimeKeeper" onClick={openTimeKeeper}><span className="em-app-icon small">T</span></button><span>⌃　◉　▂</span><time dateTime="2026-10-16T10:16:00">10:16 AM<br/>10/16/2026</time></div>
    </footer>
  </section>;
}
