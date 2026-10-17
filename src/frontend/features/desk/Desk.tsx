import { useEffect, useState } from 'react';
import { type ScreenProps } from '../../api/client';
import { Card } from '../../shared/components/Card';

export function Desk({core,navigate}:ScreenProps) {
  const [theme,setTheme]=useState(document.documentElement.getAttribute('data-theme')??'auto');
  useEffect(()=>{
    const observer=new MutationObserver(()=>setTheme(document.documentElement.getAttribute('data-theme')??'auto'));
    observer.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
    return()=>observer.disconnect();
  },[]);
  const current=core.periods.find(period=>period.sessionId===core.activeSession?.id&&period.endedAt===null);
  return <>
    <div className="row between"><div><span className="eyebrow"><button className="link" onClick={()=>navigate('settings')}>Settings</button> › Desk pill preview</span><h1>Desk pill preview</h1></div>
      <span className="small muted">Live session and case data from the application API.</span></div>
    <div className="desk"><div className="docwin"><div className="row between dochead"><span>{current?.demoWindowTitle??'Document preview'}</span>
      <span className="num">{core.activeSession?.startedAt.slice(11,16)??'—'}</span></div><div className="docpage">
      <h2>MEMORANDUM OF LAW IN OPPOSITION</h2><p>Supreme Court of the State of New York · Index No. [NUMBER]</p>
      <p>Draft document preview</p></div></div>
      <iframe title="Interactive desk pill preview" src={'/pill.html?theme='+theme} className="desk-preview-frame"/>
    </div>
    <Card><span className="small muted">Simulate a file switch in the pill preview above. Closing the desktop window leaves the session active; Screenpipe commands start and end it.</span></Card>
  </>;
}
