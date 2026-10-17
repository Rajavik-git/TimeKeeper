import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { api, type CoreState, type State } from '../../../api/client';
import { configuredRate, dayFees, effectiveMs, formatPreciseDuration, type Period } from '../../../calculations/billing';
import { money, rate } from '../../../shared/format';
import { Logo } from '../../../shared/brand/Logo';
import './pill.css';

const tauri = '__TAURI_INTERNALS__' in window;
const emulator = new URLSearchParams(window.location.search).has('emulator');
const requestedTheme = new URLSearchParams(window.location.search).get('theme') ?? (emulator ? localStorage.getItem('timekeeper-theme') : null);
if (requestedTheme === 'dark' || requestedTheme === 'light') document.documentElement.dataset.theme=requestedTheme;
const demoDocuments = [
  '2025-031 Opposition Brief v3.docx',
  '[2025-031] Defendant\'s documents.eml',
  '2025-031 Engagement letter - Paul Dawson.pdf',
  '2025-031 Defendant exhibits 1-12 - index.pdf',
  '2025-031 Letter to client - defendant\'s position.docx',
  'Research - notice of appeal deadline for family court orders.docx',
  '2026-004 Petition for dissolution of marriage - Bennett.pdf',
  '2026-004 Hearing preparation notes.docx',
  '2026-009 Letter to landlord - rent proposal.docx',
  '2026-009 Lease renewal notice - Linden Street Properties.pdf',
  '2026-012 Lumen Bylaws draft v2.docx',
  '2026-015 Memo on right of first refusal.docx',
  'Meeting request - new matter.eml',
  'Program Manager',
];
type Suggestion = { caseId:string; client:string; title:string; reference:string; reason:string };
type Recognition = { suggestion:Suggestion|null; alternatives:Suggestion[]; confidence:'high'|'low' };
type Notice = { windowTitle:string; appName:string; recognition:Recognition; seconds:number; at:string };
type PillPlacement = {anchorX:number;anchorY:number;above:boolean;width:number;height:number;barHeight:number};
type BrowserPosition = {x:number;y:number};
const positionKey='timekeeper:pill-position';
function savedPosition():BrowserPosition {
  try {const value=JSON.parse(localStorage.getItem(positionKey)??'null');
    return value&&Number.isFinite(value.x)&&Number.isFinite(value.y)?{x:value.x,y:value.y}:{x:0,y:0};
  }catch{return {x:0,y:0};}
}

function Pill() {
  const [state,setState]=useState<State>();
  const [core,setCore]=useState<CoreState>();
  const [offline,setOffline]=useState(false);
  const [expanded,setExpanded]=useState(false);
  const [notice,setNotice]=useState<Notice|null>(null);
  const [closingSwitch,setClosingSwitch]=useState(false);
  const [recent,setRecent]=useState<{id:string;title:string}|null>(null);
  useEffect(()=>{if(!recent)return;const timer=window.setTimeout(()=>setRecent(value=>value?.id===recent.id?null:value),5000);return()=>window.clearTimeout(timer);},[recent?.id]);
  const [feedback,setFeedback]=useState<{id:string;text:string;undoToken:string|null;showText:boolean}|null>(null);
  const [selectedCase,setSelectedCase]=useState('');
  const [dismissedQuestion,setDismissedQuestion]=useState<string|null>(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [now,setNow]=useState(Date.now());
  const [browserPosition,setBrowserPosition]=useState<BrowserPosition>(savedPosition);
  const [above,setAbove]=useState(false);
  const [popupHeight,setPopupHeight]=useState(0);
  const [placementVersion,setPlacementVersion]=useState(0);
  const nativePlacement=useRef<PillPlacement|null>(null);
  const ignoreNativeMoveUntil=useRef(0);
  const dragStart=useRef<{x:number;y:number;origin:BrowserPosition}|null>(null);
  useEffect(()=>{
    if(!feedback)return;
    const textTimer=window.setTimeout(()=>setFeedback(value=>value?.id===feedback.id?{...value,showText:false}:value),2000);
    const undoTimer=window.setTimeout(()=>setFeedback(value=>value?.id===feedback.id?null:value),feedback.undoToken?5000:2000);
    return()=>{window.clearTimeout(textTimer);window.clearTimeout(undoTimer);};
  },[feedback?.id]);
  const confirmInline=(text:string,undoToken:string|null)=>setFeedback({id:crypto.randomUUID(),text,undoToken,showText:true});
  const debounce=useRef<number|undefined>(undefined);
  const switching=useRef(false);
  const previous=useRef('');
  const dismissedSwitch=useRef(new Set<string>());
  const observed=useRef<{id:string;at:number}|null>(null);
  const coreRef=useRef<CoreState|undefined>(undefined);
  coreRef.current=core;
  const stateRef=useRef<State|undefined>(undefined);
  stateRef.current=state;
  if(tauri&&!nativePlacement.current) {
    const saved=savedPosition();
    if(localStorage.getItem(positionKey))nativePlacement.current={anchorX:saved.x,anchorY:saved.y,above:false,width:0,height:0,barHeight:38};
  }
  const refresh=useCallback(async()=>{
    try {
      const [legacy,session,periods,questions]=await Promise.all([
        api.GET('/api/state'),api.GET('/api/sessions/active'),api.GET('/api/work-periods'),api.GET('/api/questions'),
      ]);
      if(legacy.error||session.error||periods.error||questions.error||!legacy.data) throw Error('State unavailable');
      setState(legacy.data);
      setCore({activeSession:session.data??null,sessions:[],periods:periods.data??[],questions:questions.data??[],sources:[],coverageGaps:[],billing:{invoices:[],lines:[],expenses:[]}});
      setOffline(false);
    } catch {setOffline(true);}
  },[]);
  useEffect(()=>{void refresh();const poll=window.setInterval(()=>{void refresh();setNow(Date.now());},5000);return()=>window.clearInterval(poll);},[refresh]);
  const active=core?.activeSession;
  const current=core?.periods.find(p=>p.sessionId===active?.id&&p.endedAt===null);
  const dayDate=current?.startedAt.slice(0,10)??active?.startedAt.slice(0,10);
  if(current&&observed.current?.id!==current.id)observed.current={id:current.id,at:Date.now()};
  const caseItem=state?.matter.find(m=>String(m.id)===current?.caseId);
  const owner=state?.client.find(c=>c.id===caseItem?.client_id);
  const setting=state?.setting[0];
  const pauseReason=active?'Desk pill:'+active.id:null;
  const openPause=state?.pause.find(p=>p.reason===pauseReason&&p.end_time===null);
  const paused=!!active&&!!openPause;
  const pending=(core?.periods.filter(p=>p.sessionId===active?.id&&p.startedAt.slice(0,10)===dayDate&&!p.excluded&&(!p.timeValidated||!p.caseId))??[])
    .sort((a,b)=>{
      const readyA=!!a.caseId&&effectiveMs(a)!==null,readyB=!!b.caseId&&effectiveMs(b)!==null;
      return Number(readyB)-Number(readyA)||(readyA&&readyB?(effectiveMs(a)!-effectiveMs(b)!):a.startedAt.localeCompare(b.startedAt));
    });
  const readyPending=pending.filter(p=>p.caseId&&effectiveMs(p)!==null);
  const question=core?.questions.find(q=>q.sessionId===active?.id&&q.status==='pending');
  const questionPeriod=core?.periods.find(p=>p.id===question?.periodId);
  const showQuestion=!!question&&!!questionPeriod&&!questionPeriod.excluded;
  const showQuestionNotice=showQuestion&&!!setting?.notifications&&question?.questionId!==dismissedQuestion;
  const clockStart=current?(tauri?Date.parse(current.startedAt):(observed.current?.at??now)):null;
  const pausedMs=clockStart===null?0:(state?.pause??[]).filter(p=>p.reason===pauseReason).reduce((total,p)=>{
    const parsePause=(time:string)=>Date.parse(p.date+'T'+(time.length===5?time+':00':time)+'Z');
    const from=parsePause(p.start_time);
    let to=p.end_time?parsePause(p.end_time):now;
    if(to<from)to+=86400000;
    return total+Math.max(0,Math.min(now,to)-Math.max(clockStart,from));
  },0);
  const liveElapsed=clockStart===null?null:Math.max(0,now-clockStart-pausedMs);
  const periodMs=current ? effectiveMs(current)??liveElapsed : null;
  const hourlyRate=state&&caseItem?configuredRate(state,caseItem.id):null;
  const amount=periodMs!==null&&hourlyRate&&hourlyRate.origin!=='flat_fee' ? money(Math.round(periodMs*hourlyRate.rateCents/3600000)) : '—';
  const barValue=setting?.pill_display==='time'?(current?formatPreciseDuration(periodMs):'—'):amount;
  const day=dayDate?core?.periods.filter(p=>p.startedAt.startsWith(dayDate)&&!p.excluded)??[]:[];
  const pricedDay=day.map(period=>period.id===current?.id&&periodMs!==null?{...period,durationOverrideMs:periodMs}:period);
  const todayAmount=state&&core?money(dayFees(state,core,pricedDay)):'—';
  useEffect(()=>{if(tauri&&setting)void getCurrentWindow().setAlwaysOnTop(setting.pill_always_on_top).catch(()=>setError('Unable to set pill position.'));},[setting?.pill_always_on_top]);

  useEffect(()=>{

    if(!tauri)return;
    let cancelled=false,stop:(()=>void)|undefined,timer=0;
    void getCurrentWindow().onMoved(({payload})=>{
      if(Date.now()<ignoreNativeMoveUntil.current)return;
      window.clearTimeout(timer);
      timer=window.setTimeout(()=>{
        const previous=nativePlacement.current;
        if(!previous||!previous.width)return;
        const next={...previous,anchorX:payload.x+previous.width/2,
          anchorY:payload.y+(previous.above?previous.height-previous.barHeight:0)};
        nativePlacement.current=next;
        localStorage.setItem(positionKey,JSON.stringify({x:next.anchorX,y:next.anchorY}));
        setPlacementVersion(value=>value+1);
      },220);
    }).then(unlisten=>{if(cancelled)unlisten();else stop=unlisten;});
    return()=>{cancelled=true;stop?.();window.clearTimeout(timer);};
  },[]);
  useEffect(()=>{
    const bar=document.querySelector<HTMLElement>('.pill-bar');
    const content=[...document.querySelectorAll<HTMLElement>('.pill-panel,.pill-notice,.pill-error')];
    let frame=0;
    const resize=()=>{
      window.cancelAnimationFrame(frame);
      frame=window.requestAnimationFrame(()=>{
        const popup=content.find(element=>element.matches('.pill-panel,.pill-notice'));
        const popupSize=popup?.offsetHeight??0;
        setPopupHeight(popupSize);
        const contentWidth=Math.ceil(Math.max(bar?.offsetWidth??0,...content.map(element=>element.offsetWidth)));

        const contentHeight=Math.ceil(Math.max(bar?.offsetHeight??0,...content.map(element=>46+element.offsetHeight)));
        if(tauri){
          const anchor=nativePlacement.current;
          ignoreNativeMoveUntil.current=Date.now()+400;
          void invoke<PillPlacement>('set_pill_expanded',{expanded,notification:!!notice||!!recent||(!expanded&&showQuestionNotice),
            contentWidth,contentHeight,anchorX:anchor?.anchorX??null,anchorY:anchor?.anchorY??null})
            .then(position=>{nativePlacement.current=position;setAbove(position.above);
              localStorage.setItem(positionKey,JSON.stringify({x:position.anchorX,y:position.anchorY}));})
            .catch(()=>setError('Unable to resize the pill.'));
        }else if(emulator&&window.parent!==window)window.parent.postMessage({type:'timekeeper:pill-height',height:contentHeight+12},window.location.origin);
        else setAbove(!!popup&&browserPosition.y+46+popupSize>window.innerHeight&&browserPosition.y>=popupSize+8);
      });
    };
    const observer=new ResizeObserver(resize);
    if(bar)observer.observe(bar);
    content.forEach(element=>observer.observe(element));
    resize();
    return()=>{observer.disconnect();window.cancelAnimationFrame(frame);};
  },[expanded,notice,recent,showQuestionNotice,error,placementVersion,browserPosition.x,browserPosition.y]);
  const showSwitch=useCallback(async(windowTitle:string,appName:string)=>{
    if(!coreRef.current?.activeSession||!windowTitle.trim()||!appName.trim()||previous.current===appName+':'+windowTitle)return;
    previous.current=appName+':'+windowTitle;
    try {
      const result=await api.POST('/api/recognize',{body:{windowTitle,appName}});
      if(result.error||!result.data)throw Error('Unable to recognize this file.');
      if(!result.data.suggestion&&!/\.[a-z0-9]{1,8}(?=\s|$|[-—])/i.test(windowTitle))return;
      const currentCore=coreRef.current;
      const latest=currentCore?.periods.filter(p=>p.sessionId===currentCore.activeSession?.id).map(p=>p.endedAt??p.startedAt).sort().at(-1);
      const at=!tauri&&latest?new Date(Date.parse(latest)+60000).toISOString():new Date().toISOString();
      setNotice({windowTitle,appName,recognition:result.data,seconds:20,at});
      setRecent(null);setSelectedCase('');setExpanded(false);setClosingSwitch(false);setError('');
    }catch(error){previous.current='';setError(String(error));}
  },[]);
  const dismiss=useCallback(()=>{
    if(notice&&switching.current)dismissedSwitch.current.add(notice.appName+':'+notice.windowTitle+':'+notice.at);
    setNotice(null);setRecent(null);setExpanded(false);setSelectedCase('');
    // Keep a pending question in the panel/My day without immediately reopening its popup.
    if(question?.questionId)setDismissedQuestion(question.questionId);
  },[notice,question?.questionId]);
  useEffect(()=>{
    const onEscape=(event:KeyboardEvent)=>{
      if(event.key==='Escape'&&(notice||recent||showQuestionNotice||expanded)){
        event.preventDefault();dismiss();
      }
    };
    window.addEventListener('keydown',onEscape);
    return()=>window.removeEventListener('keydown',onEscape);
  },[notice,recent,showQuestionNotice,expanded,dismiss]);
  useEffect(()=>{
    if(!tauri)return;
    let unlisten:(()=>void)|undefined,cancelled=false;
    void listen<{windowTitle:string;appName:string}>('active-window-changed',event=>{
      window.clearTimeout(debounce.current);
      debounce.current=window.setTimeout(()=>void showSwitch(event.payload.windowTitle,event.payload.appName),3000);
    }).then(stop=>{if(cancelled)stop();else unlisten=stop;});
    return()=>{cancelled=true;unlisten?.();window.clearTimeout(debounce.current);};
  },[showSwitch]);

  useEffect(()=>{
    if(!emulator||window.parent===window)return;
    const onMessage=(event:MessageEvent)=>{
      if(event.origin!==window.location.origin||event.source!==window.parent)return;
      const value=event.data;
      if(value?.type==='timekeeper:theme'){
        if(value.theme==='dark'||value.theme==='light')document.documentElement.dataset.theme=value.theme;
        else document.documentElement.removeAttribute('data-theme');
        return;
      }
      if(value?.type==='timekeeper:pill-placement'&&typeof value.above==='boolean'){
        setAbove(value.above);return;
      }
      if(value?.type!=='timekeeper:active-window-changed'||typeof value.windowTitle!=='string'||typeof value.appName!=='string')return;
      window.clearTimeout(debounce.current);
      debounce.current=window.setTimeout(()=>void showSwitch(value.windowTitle,value.appName),3000);
    };
    window.addEventListener('message',onMessage);
    return()=>{window.removeEventListener('message',onMessage);window.clearTimeout(debounce.current);};
  },[showSwitch]);

  const switchTo=useCallback(async(target:Notice,caseId:string|null,automatic=false)=>{
    if(switching.current)return;
    switching.current=true;
    setBusy(true);
    try {
      const response=await api.POST('/api/pill/decision',{body:{kind:'switch',caseId,windowTitle:target.windowTitle,appName:target.appName,at:target.at}});
      if(response.error||!response.data)throw Error('Unable to record the file switch.');
      const acceptedTitle=caseId===null?'Not client work':stateRef.current?.matter.find(item=>String(item.id)===caseId)?.title??target.recognition.suggestion?.title??'Which case?';
      if(!dismissedSwitch.current.has(target.appName+':'+target.windowTitle+':'+target.at)) {
        confirmInline(caseId===null?'Marked as not client work':`Assigned to ${acceptedTitle}`,response.data.undoToken);
        setRecent(automatic?{id:response.data.period.id,title:acceptedTitle}:null);
      }
      setClosingSwitch(true);
      window.setTimeout(()=>{setNotice(value=>value?.at===target.at?null:value);setClosingSwitch(false);},140);
      setSelectedCase('');await refresh();
    }catch(error){setError(String(error));}
    finally{dismissedSwitch.current.delete(target.appName+':'+target.windowTitle+':'+target.at);switching.current=false;setBusy(false);}
  },[refresh]);
  useEffect(()=>{
    if(!notice||closingSwitch||notice.recognition.confidence!=='high'||!notice.recognition.suggestion||selectedCase)return;
    const timer=window.setInterval(()=>setNotice(value=>value?{...value,seconds:Math.max(0,value.seconds-1)}:null),1000);
    return()=>window.clearInterval(timer);
  },[notice?.windowTitle,notice?.recognition.confidence,selectedCase,closingSwitch]);
  useEffect(()=>{if(!closingSwitch&&notice?.seconds===0&&notice.recognition.confidence==='high'&&notice.recognition.suggestion&&!selectedCase)void switchTo(notice,notice.recognition.suggestion.caseId,true);},[notice?.seconds,selectedCase,closingSwitch]);
  const validate=async(periods:Period[])=>{
    setBusy(true);
    try {
      const response=await api.POST('/api/pill/decision',{body:{kind:'validate',periodIds:periods.filter(p=>p.caseId).map(p=>p.id),
        expectedEffectiveRevisions:Object.fromEntries(periods.map(period=>[period.id,period.effectiveRevision]))}});
      if(response.error||!response.data)throw Error('A case and duration are required before validation.');
      setExpanded(false);setRecent(null);confirmInline(periods.length===1?'Period validated':`${periods.length} periods validated`,response.data.undoToken);
      await refresh();
    }catch(error){setError(String(error));}finally{setBusy(false);}
  };
  const assign=async(periodId:string,caseId:string)=>{
    const period=core?.periods.find(p=>p.id===periodId);
    if(!period)return;
    setBusy(true);
    try {
      const response=await api.POST('/api/pill/decision',{body:{kind:'assign',periodId,caseId,expectedAssignmentRevision:period.assignmentRevision}});
      if(response.error||!response.data)throw Error('Unable to assign this case.');
      setSelectedCase('');setExpanded(false);setRecent(null);setNotice(null);
      if(question?.periodId===periodId)setDismissedQuestion(question.questionId);
      confirmInline(`Assigned to ${state?.matter.find(item=>String(item.id)===caseId)?.title??'case'}`,response.data.undoToken);
      await refresh();
    }catch(error){setError(String(error));}finally{setBusy(false);}
  };
  const excludeQuestion=async()=>{
    if(!questionPeriod)return;
    setBusy(true);
    try {
      const response=await api.POST('/api/pill/decision',{body:{kind:'exclude',periodId:questionPeriod.id,
        expectedAssignmentRevision:questionPeriod.assignmentRevision,expectedEffectiveRevision:questionPeriod.effectiveRevision}});
      if(response.error||!response.data)throw Error('Unable to leave this period out.');
      setSelectedCase('');setExpanded(false);setRecent(null);setNotice(null);
      if(question?.questionId)setDismissedQuestion(question.questionId);
      confirmInline('Marked as not client work',response.data.undoToken);await refresh();
    }catch(error){setError(String(error));}finally{setBusy(false);}
  };
  const setPause=async()=>{
    if(!state||!active)return;
    setBusy(true);
    try {
      const open=state.pause.find(p=>p.reason===pauseReason&&p.end_time===null);
      const instant=new Date().toISOString(),time=instant.slice(11,19);
      const response=open?await api.PATCH('/api/pauses/{id}',{params:{path:{id:open.id}},body:{end_time:time}}):
        await api.POST('/api/pauses',{body:{date:instant.slice(0,10),start_time:time,reason:pauseReason??'Desk pill'}});
      if(response.error)throw Error('Unable to change pause state.');await refresh();
    }catch(error){setError(String(error));}finally{setBusy(false);}
  };

  const undo=async()=>{
    if(!feedback?.undoToken||busy)return;
    setBusy(true);
    try {
      const response=await api.POST('/api/pill/undo',{body:{undoToken:feedback.undoToken}});
      if(response.error)throw Error('This choice can no longer be undone.');
      setNotice(null);setRecent(null);setExpanded(false);confirmInline('Choice undone',null);await refresh();
    }catch(error){setError(String(error));setFeedback(null);}finally{setBusy(false);}
  };

  const openDay=()=>{if(tauri)void invoke('open_my_day').catch(()=>setError('Unable to open TimeKeeper.'));else if(emulator&&window.parent!==window)window.parent.postMessage({type:'timekeeper:open-app'},window.location.origin);else window.open('/','_blank');};
  const openCases=state?.matter.filter(m=>m.status==='open')??[];
  const recentPeriod=core?.periods.find(period=>period.id===recent?.id);
  const togglePanel=()=>offline?void refresh():notice||recent||showQuestionNotice?dismiss():setExpanded(!expanded);
  const clampBrowser=(value:BrowserPosition):BrowserPosition=>{
    const margin=Math.max(0,(window.innerWidth-360)/2);
    let y=Math.max(0,Math.min(window.innerHeight-38,value.y));
    if(popupHeight){const belowMax=window.innerHeight-46-popupHeight,aboveMin=popupHeight+8;
      if(y>belowMax&&y<aboveMin)y=y-belowMax<aboveMin-y?Math.max(0,belowMax):Math.min(window.innerHeight-38,aboveMin);
    }
    return {x:Math.max(-margin,Math.min(margin,value.x)),y};
  };
  const moveBy=(dx:number,dy:number,reset=false)=>{
    if(tauri){
      if(reset){nativePlacement.current=null;localStorage.removeItem(positionKey);}
      else if(nativePlacement.current)nativePlacement.current={...nativePlacement.current,
        anchorX:nativePlacement.current.anchorX+dx,anchorY:nativePlacement.current.anchorY+dy};
      setPlacementVersion(value=>value+1);
    }else if(emulator&&window.parent!==window){
      window.parent.postMessage({type:'timekeeper:pill-nudge',dx,dy,reset},window.location.origin);
    }else{
      const next=reset?{x:0,y:0}:clampBrowser({x:browserPosition.x+dx,y:browserPosition.y+dy});
      setBrowserPosition(next);localStorage.setItem(positionKey,JSON.stringify(next));
    }
  };
  const beginDrag=(event:ReactPointerEvent<HTMLElement>)=>{
    if(event.button!==0)return;
    if(tauri){void getCurrentWindow().startDragging().catch(()=>setError('Unable to move the pill.'));return;}
    if(emulator&&window.parent!==window){
      window.parent.postMessage({type:'timekeeper:pill-drag-start',screenX:event.screenX,screenY:event.screenY},window.location.origin);
      event.currentTarget.setPointerCapture(event.pointerId);return;
    }
    dragStart.current={x:event.clientX,y:event.clientY,origin:browserPosition};
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const dragMove=(event:ReactPointerEvent<HTMLElement>)=>{
    if(emulator&&window.parent!==window){
      if(event.currentTarget.hasPointerCapture(event.pointerId))window.parent.postMessage({type:'timekeeper:pill-drag-move',screenX:event.screenX,screenY:event.screenY},window.location.origin);
      return;
    }
    const start=dragStart.current;if(!start)return;
    setBrowserPosition(clampBrowser({x:start.origin.x+event.clientX-start.x,y:start.origin.y+event.clientY-start.y}));
  };
  const endDrag=(event:ReactPointerEvent<HTMLElement>)=>{
    if(emulator&&window.parent!==window){
      window.parent.postMessage({type:'timekeeper:pill-drag-end',screenX:event.screenX,screenY:event.screenY},window.location.origin);
      if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    const start=dragStart.current;if(!start)return;
    const next=clampBrowser({x:start.origin.x+event.clientX-start.x,y:start.origin.y+event.clientY-start.y});
    setBrowserPosition(next);
    dragStart.current=null;
    if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
    localStorage.setItem(positionKey,JSON.stringify(next));
  };
  const dragKey=(event:ReactKeyboardEvent<HTMLElement>)=>{
    if(!event.altKey)return;
    const delta=event.key==='ArrowLeft'?[-20,0]:event.key==='ArrowRight'?[20,0]:event.key==='ArrowUp'?[0,-20]:event.key==='ArrowDown'?[0,20]:null;
    if(event.key==='Home'){event.preventDefault();moveBy(0,0,true);}
    else if(delta){event.preventDefault();moveBy(delta[0],delta[1]);}
  };
  const rootStyle=tauri||emulator?{'--pill-popup-height':`${popupHeight}px`} as CSSProperties:
    {transform:`translate(${browserPosition.x}px,${browserPosition.y}px)`,'--pill-popup-height':`${popupHeight}px`} as CSSProperties;
  return <main className={'pill-root'+(above?(tauri||emulator?' native-above':' browser-above'):'')} style={rootStyle}>
    <div className={'pill-bar '+(offline?'offline':'')+(paused?' is-paused':'')}>
    <span className="pill-drag" role="button" tabIndex={0} aria-label="Move pill" title="Drag to move · double-click to reset · Alt+arrows to move"
      onPointerDown={beginDrag} onPointerMove={dragMove} onPointerUp={endDrag} onPointerCancel={endDrag}
      onDoubleClick={()=>moveBy(0,0,true)} onKeyDown={dragKey}><span className="pill-mark"><Logo compact wordmark={false}/></span></span>
    <button className="pill-main" onClick={togglePanel} aria-expanded={expanded} aria-label={offline?'TimeKeeper disconnected, retry':'TimeKeeper, toggle panel'}>
      {offline?<><span className="pill-who">TimeKeeper is not running</span><span className="pill-retry">Retry</span></>:<>
        <span className={'pill-rec '+(paused||!active?'paused':'')}/><span className={'pill-who'+(feedback?.showText?' confirming':'')} title={feedback?.showText?feedback.text:owner&&caseItem?owner.name+' · '+caseItem.title:undefined}>{feedback?.showText?feedback.text:paused?'Paused':caseItem?.title??(active?'Which case?':'No active session')}</span>
        {!feedback?.showText&&setting?.pill_display!=='case'&&barValue!=='—'&&<strong className="pill-amount">{barValue}</strong>}
        {!feedback?.showText&&pending.length>0&&<span className="pill-badge" aria-label={pending.length+' periods to validate'}>{pending.length}</span>}</>}
    </button>
    {feedback?.undoToken&&<button className="pill-undo" disabled={busy} onClick={()=>void undo()} aria-label="Undo last choice" title="Undo last choice">Undo</button>}
    {!offline&&active&&<button className="pill-pause" disabled={busy} onClick={()=>void setPause()} aria-label={paused?'Resume recording':'Pause recording'} title={paused?'Resume recording':'Pause recording'}>
      {paused?<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 9 6-9 6z"/></svg>:<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6v12M16 6v12"/></svg>}
    </button>}
    {!offline&&<button className="pill-chevron" onClick={togglePanel} aria-label="Toggle pill panel" title="Toggle panel">⌄</button>}
    </div>
    {expanded&&!offline&&<section className="pill-panel" aria-label="TimeKeeper panel">
      <header><div className="pill-heading"><strong>{caseItem?.title??(active?'Which case?':'No active session')}</strong><span>{caseItem?.reference??''}</span></div>
        <small>{owner?.name??'Unassigned'}{hourlyRate&&hourlyRate.origin!=='flat_fee'?' · '+hourlyRate.origin.replace('_',' ')+' rate '+rate(hourlyRate.rateCents):''}</small>
        <small>Session since {active?.startedAt.slice(11,16)??'—'} · this period since {current?.startedAt.slice(11,16)??'—'}</small></header>
      <div className="pill-kpis"><div><small>This period</small><strong>{formatPreciseDuration(periodMs)}</strong></div><div><small>Amount</small><strong>{amount}</strong></div><div><small>Today</small><strong>{todayAmount}</strong></div></div>
      <div className="pill-review"><div className="pill-row"><small>To validate · {pending.length}</small></div>
        {pending.slice(0,2).map(period=><div className="pill-row" key={period.id}><div><strong>{period.label||state?.matter.find(m=>String(m.id)===period.caseId)?.title||'Which case?'}</strong>
          <small>{period.startedAt.slice(11,16)}–{period.endedAt?.slice(11,16)??'…'} · {formatPreciseDuration(effectiveMs(period))}</small></div>
          {period.caseId&&<button className="pill-button action" disabled={busy||effectiveMs(period)===null} title={effectiveMs(period)===null?'Add a duration in My day before validation':undefined} onClick={()=>void validate([period])}>Validate</button>}</div>)}
        {(pending.length>2||readyPending.length>0)&&<div className="pill-row"><small>{pending.length>2?'+ '+(pending.length-2)+' more':pending.length-readyPending.length>0?(pending.length-readyPending.length)+' need case or duration':''}</small>
          {readyPending.length>0&&<button className="pill-button action" disabled={busy} title={pending.length>readyPending.length?(pending.length-readyPending.length)+' periods still need a case or duration':undefined} onClick={()=>void validate(readyPending)}>Validate all {readyPending.length}</button>}</div>}
      </div>
      {showQuestion&&<div className="pill-question"><strong>Which case was this? · {questionPeriod?.label}</strong><select aria-label="Choose a case for this period" value={selectedCase} disabled={busy} onChange={event=>{setSelectedCase(event.target.value);if(event.target.value)void assign(questionPeriod!.id,event.target.value);}}><option value="">Choose a case</option>{openCases.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select><button className="pill-button" disabled={busy} onClick={()=>void excludeQuestion()}>Not client work</button></div>}
      <footer><button className="pill-button" disabled={!active||busy} onClick={()=>void setPause()}>{paused?'Resume':'Pause'}</button><select aria-label="Change case" value="" disabled={!current||busy} onChange={event=>void assign(current!.id,event.target.value)}><option value="">Change case</option>{openCases.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select><button className="pill-button" onClick={openDay}>Open TimeKeeper</button></footer>
    </section>}
    {notice&&!offline&&<section className={'pill-notice'+(closingSwitch?' closing':'')} role="status" aria-label="File switch suggestion"><button className="pill-dismiss" aria-label="Dismiss" onClick={dismiss}>×</button><span className="pill-note-icon">!</span><div className="pill-note-body"><strong>Switched to {notice.windowTitle}</strong>
      <small>{notice.recognition.suggestion?notice.recognition.suggestion.title+'? · '+notice.recognition.suggestion.reason:'Which case is this?'}</small>
      <div className="pill-note-actions"><button className="pill-button action" disabled={!notice.recognition.suggestion||busy} onClick={()=>void switchTo(notice,notice.recognition.suggestion?.caseId??null)}>Confirm{notice.recognition.confidence==='high'?' · '+notice.seconds+'s':''}</button>
        <select aria-label="Other case" value={selectedCase} disabled={busy} onChange={event=>{setSelectedCase(event.target.value);if(event.target.value)void switchTo(notice,event.target.value);}}><option value="">Choose a case…</option>{[...notice.recognition.alternatives,...openCases.filter(item=>!notice.recognition.alternatives.some(alt=>alt.caseId===String(item.id))).map(item=>({caseId:String(item.id),title:item.title}))].map(item=><option key={item.caseId} value={item.caseId}>{item.title}</option>)}</select></div>
      <div className="pill-note-actions"><button className="pill-button text" disabled={busy} onClick={()=>void switchTo(notice,null)}>Not client work</button><button className="pill-button text" onClick={dismiss}>Later</button></div></div></section>}
    {recent&&!notice&&!expanded&&!offline&&<section className="pill-notice" role="status" aria-label="New work period"><button className="pill-dismiss" aria-label="Dismiss" onClick={dismiss}>×</button><span className="pill-note-icon"><Logo compact wordmark={false}/></span><div className="pill-note-body"><strong>New period recognized</strong>
      <small>{recent.title} · review the new period in My day</small><div className="pill-note-actions"><button className="pill-button action" disabled={!recentPeriod?.caseId||effectiveMs(recentPeriod)===null||busy} title={effectiveMs(recentPeriod??{detectedDurationMs:null,durationOverrideMs:null})===null?'Add a duration in My day first':undefined} onClick={()=>recentPeriod&&void validate([recentPeriod])}>Validate</button><select aria-label="Change new period case" value="" disabled={!recentPeriod||busy} onChange={event=>{if(event.target.value)void assign(recent.id,event.target.value);}}><option value="">Change case…</option>{openCases.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></div><div className="pill-note-actions"><button className="pill-button text" onClick={openDay}>Open TimeKeeper</button><button className="pill-button text" onClick={dismiss}>Later</button></div></div></section>}
    {showQuestionNotice&&!notice&&!recent&&!expanded&&!offline&&<section className="pill-notice" role="status" aria-label="Which case"><button className="pill-dismiss" aria-label="Dismiss" onClick={dismiss}>×</button><span className="pill-note-icon">!</span><div className="pill-note-body"><strong>Which case was this?</strong>
      <small>{questionPeriod?.startedAt.slice(11,16)}–{questionPeriod?.endedAt?.slice(11,16)??'…'} · {questionPeriod?.label}</small>
      <div className="pill-note-actions"><select aria-label="Choose a case for this period" value={selectedCase} disabled={busy} onChange={event=>{setSelectedCase(event.target.value);if(event.target.value)void assign(questionPeriod!.id,event.target.value);}}><option value="">Choose a case</option>{openCases.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></div>
      <div className="pill-note-actions"><button className="pill-button text" disabled={busy} onClick={()=>void excludeQuestion()}>Not client work</button><button className="pill-button text" onClick={dismiss}>Later</button></div></div></section>}
    {!tauri&&!emulator&&<label className="pill-simulate">Simulate file switch<select aria-label="Simulate file switch" value="" onChange={event=>void showSwitch(event.target.value,'Demo documents')}><option value="">Choose a demo document</option>{demoDocuments.map(file=><option key={file} value={file}>{file==='Program Manager'?'Program Manager (non-document)':file}</option>)}</select></label>}
    {error&&<p className="pill-error" role="alert">{error}</p>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Pill/>);
