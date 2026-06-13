import { useState, useEffect, useRef } from "react";

// ── constants ──────────────────────────────────────────────────────────────────
const MUSCLE_GROUPS = ["Chest","Triceps","Shoulders","Back","Biceps","Forearms","Rear Delts","Quads","Hamstrings","Calves","Abs"];
const EQUIPMENT_TYPES = ["Barbell","Dumbbell","Machine","Cable","Bodyweight","Smith Machine","EZ Bar","Other"];
const DAYS_OF_WEEK = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

const INITIAL_EXERCISES = [
  { id:"e1",  name:"Bench Press",          primary:"Chest",      secondary:["Triceps","Shoulders"],   equipment:"Barbell"    },
  { id:"e2",  name:"Incline Bench Press",  primary:"Chest",      secondary:["Triceps","Shoulders"],   equipment:"Barbell"    },
  { id:"e3",  name:"Squat",                primary:"Quads",      secondary:["Hamstrings"],            equipment:"Barbell"    },
  { id:"e4",  name:"Deadlift",             primary:"Back",       secondary:["Hamstrings","Forearms"], equipment:"Barbell"    },
  { id:"e5",  name:"Pull-up",              primary:"Back",       secondary:["Biceps","Rear Delts"],   equipment:"Bodyweight" },
  { id:"e6",  name:"Overhead Press",       primary:"Shoulders",  secondary:["Triceps"],               equipment:"Barbell"    },
  { id:"e7",  name:"Barbell Row",          primary:"Back",       secondary:["Biceps","Rear Delts"],   equipment:"Barbell"    },
  { id:"e8",  name:"T-Bar Row",            primary:"Back",       secondary:["Biceps","Rear Delts"],   equipment:"Machine"    },
  { id:"e9",  name:"Leg Press",            primary:"Quads",      secondary:["Hamstrings"],            equipment:"Machine"    },
  { id:"e10", name:"Romanian Deadlift",    primary:"Hamstrings", secondary:["Back"],                  equipment:"Barbell"    },
  { id:"e11", name:"Tricep Pushdown",      primary:"Triceps",    secondary:[],                        equipment:"Cable"      },
  { id:"e12", name:"Bicep Curl",           primary:"Biceps",     secondary:["Forearms"],              equipment:"Barbell"    },
  { id:"e13", name:"Lateral Raise",        primary:"Shoulders",  secondary:[],                        equipment:"Dumbbell"   },
  { id:"e14", name:"Calf Raise",           primary:"Calves",     secondary:[],                        equipment:"Machine"    },
  { id:"e15", name:"Cable Fly",            primary:"Chest",      secondary:["Shoulders"],             equipment:"Cable"      },
  { id:"e16", name:"Dumbbell Row",         primary:"Back",       secondary:["Biceps"],                equipment:"Dumbbell"   },
  { id:"e17", name:"Face Pull",            primary:"Rear Delts", secondary:["Shoulders"],             equipment:"Cable"      },
  { id:"e18", name:"Leg Curl",             primary:"Hamstrings", secondary:[],                        equipment:"Machine"    },
  { id:"e19", name:"Plank",               primary:"Abs",        secondary:[],                        equipment:"Bodyweight" },
  { id:"e20", name:"Ab Crunch",            primary:"Abs",        secondary:[],                        equipment:"Bodyweight" },
];

const DEFAULT_VOLUME_SETTINGS = MUSCLE_GROUPS.reduce((acc,m)=>({...acc,[m]:{min:10,max:20}}),{});
const DEFAULT_SECONDARY_WEIGHTS = {};
INITIAL_EXERCISES.forEach(ex=>{
  ex.secondary.forEach(m=>{
    if(!DEFAULT_SECONDARY_WEIGHTS[ex.id]) DEFAULT_SECONDARY_WEIGHTS[ex.id]={};
    DEFAULT_SECONDARY_WEIGHTS[ex.id][m]=0.5;
  });
});

// ── helpers ────────────────────────────────────────────────────────────────────
function weekKey(date){
  const d=new Date(date); const day=d.getDay(); const adj=day===0?6:day-1;
  const mon=new Date(d); mon.setDate(d.getDate()-adj);
  return mon.toISOString().slice(0,10);
}
function formatDuration(seconds){
  const h=Math.floor(seconds/3600); const m=Math.floor((seconds%3600)/60); const s=seconds%60;
  if(h>0) return `${h}h ${m}m`; return `${m}m ${s}s`;
}
function calc1RM(weight,reps){ if(!weight||!reps) return 0; return weight*(1+reps/30); }
function dateKey(ts){ return new Date(ts).toISOString().slice(0,10); }
function fmtVol(v){ return v%1===0?String(Math.round(v)):v.toFixed(1); }

function getPreviousSets(exId,gym,store){
  const relevant=store.workouts.filter(w=>w.gym===gym&&w.exercises.some(we=>we.exId===exId)).sort((a,b)=>b.startTime-a.startTime);
  if(!relevant.length) return [];
  const last=relevant[0].exercises.find(we=>we.exId===exId);
  return last?last.sets:[];
}
function getRecordsForExercise(exId,store){
  const records={};
  store.workouts.forEach(w=>{
    const we=w.exercises.find(e=>e.exId===exId); if(!we) return;
    we.sets.forEach(s=>{
      const reps=s.reps||0; const weight=s.weight||0;
      if(reps<1||reps>20||!weight) return;
      if(!records[reps]||weight>records[reps].weight) records[reps]={weight,date:w.startTime,gym:w.gym};
    });
  });
  return records;
}

// Only looks at the single active split
function getPlannedForDate(jsDate, store){
  const activeSplit=(store.splits||[]).find(s=>s.id===store.activeSplitId);
  if(!activeSplit) return [];
  const dayOfWeek=jsDate.getDay(); // 0=Sun
  const dow=dayOfWeek===0?6:dayOfWeek-1; // Mon=0…Sun=6
  let match=null;
  if(activeSplit.type==="weekly"){
    match=activeSplit.days.find(d=>d.dayIndex===dow&&!d.isRest);
  } else if(activeSplit.type==="interval"&&activeSplit.startDate&&activeSplit.interval>0){
    const start=new Date(activeSplit.startDate+"T00:00:00");
    const diff=Math.floor((jsDate-start)/(1000*60*60*24));
    if(diff<0) return [];
    const pos=diff%activeSplit.interval;
    match=activeSplit.days.find(d=>d.dayIndex===pos&&!d.isRest);
  }
  if(!match) return [];
  return [{splitId:activeSplit.id,splitName:activeSplit.name,dayLabel:match.label||DAYS_OF_WEEK[dow]||`Day ${match.dayIndex+1}`,muscles:match.muscles||[],exercises:match.exercises||[]}];
}

// Get today's plan or the next upcoming training day
function getNextPlanInfo(store){
  const activeSplit=(store.splits||[]).find(s=>s.id===store.activeSplitId);
  if(!activeSplit) return null;
  const todayKey=dateKey(Date.now());
  const doneToday=store.workouts.some(w=>dateKey(w.startTime)===todayKey);
  for(let i=0;i<=14;i++){
    const check=new Date(); check.setDate(check.getDate()+i);
    if(i===0&&doneToday) continue;
    const plans=getPlannedForDate(check,{...store,activeSplitId:store.activeSplitId});
    if(plans.length>0) return {plans,date:check,isToday:i===0,doneToday};
  }
  return null;
}

// ── numeric input that allows empty while editing ──────────────────────────────
function NumInput({value,onChange,min,max,style,placeholder}){
  const [raw,setRaw]=useState(value==null||value===""?"":String(value));
  useEffect(()=>{ if(document.activeElement!==ref.current) setRaw(value==null||value===""?"":String(value)); },[value]);
  const ref=useRef();
  return (
    <input ref={ref} type="number" inputMode="decimal" value={raw} placeholder={placeholder}
      onChange={e=>{ setRaw(e.target.value); const n=parseFloat(e.target.value); if(!isNaN(n)) onChange(n); }}
      onBlur={e=>{ const n=parseFloat(e.target.value); if(isNaN(n)){ setRaw(value==null||value===""?"":String(value)); } else { const clamped=min!=null?Math.max(min,max!=null?Math.min(max,n):n):n; onChange(clamped); setRaw(String(clamped)); } }}
      style={style}
    />
  );
}

// ── storage hook ───────────────────────────────────────────────────────────────
function useStore(){
  const [state,setState]=useState(null); const [loaded,setLoaded]=useState(false);
  useEffect(()=>{
    (async()=>{
      try{ const r=await window.storage.get("gymapp_v3"); if(r&&r.value){ setState(JSON.parse(r.value)); } else{ setState(defaultState()); } }
      catch{ setState(defaultState()); } setLoaded(true);
    })();
  },[]);
  const save=async(newState)=>{ setState(newState); try{ await window.storage.set("gymapp_v3",JSON.stringify(newState)); }catch{} };
  return [state,save,loaded];
}

function defaultState(){
  return {
    exercises: INITIAL_EXERCISES,
    templates: [
      { id:"t1", name:"Push Day", gym:"Home Gym", exercises:[
        {exId:"e1",sets:[{reps:8,weight:60},{reps:8,weight:60},{reps:8,weight:60}]},
        {exId:"e6",sets:[{reps:8,weight:40},{reps:8,weight:40},{reps:8,weight:40}]},
        {exId:"e11",sets:[{reps:12,weight:20},{reps:12,weight:20},{reps:12,weight:20}]},
      ]},
      { id:"t2", name:"Pull Day", gym:"Home Gym", exercises:[
        {exId:"e7",sets:[{reps:8,weight:60},{reps:8,weight:60},{reps:8,weight:60}]},
        {exId:"e5",sets:[{reps:6,weight:0},{reps:6,weight:0},{reps:6,weight:0}]},
        {exId:"e12",sets:[{reps:12,weight:15},{reps:12,weight:15},{reps:12,weight:15}]},
      ]},
      { id:"t3", name:"Leg Day", gym:"Home Gym", exercises:[
        {exId:"e3",sets:[{reps:8,weight:100},{reps:8,weight:100},{reps:8,weight:100}]},
        {exId:"e9",sets:[{reps:12,weight:120},{reps:12,weight:120},{reps:12,weight:120}]},
        {exId:"e18",sets:[{reps:12,weight:40},{reps:12,weight:40}]},
      ]},
    ],
    workouts: [],
    gyms: ["Home Gym","Gym 1","Gym 2"],
    defaultGym: "Home Gym",
    volumeTargets: DEFAULT_VOLUME_SETTINGS,
    secondaryWeights: DEFAULT_SECONDARY_WEIGHTS,
    splits: [],
    activeSplitId: null,
    defaultRestTime: 150,
  };
}

const inputStyle={background:"#111",border:"1px solid #2a2a2a",borderRadius:8,padding:"8px 12px",color:"#fff",fontSize:14,boxSizing:"border-box",width:"100%"};

// ── main app ───────────────────────────────────────────────────────────────────
export default function App(){
  const [store,save,loaded]=useStore();
  const [tab,setTab]=useState("home");
  const [activeWorkout,setActiveWorkout]=useState(null);
  const [finishedWorkout,setFinishedWorkout]=useState(null);

  if(!loaded) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"#0f0f0f",color:"#fff",fontFamily:"system-ui"}}>
      <div style={{textAlign:"center"}}><div style={{fontSize:32,marginBottom:8,color:"#00e5ff",fontWeight:700}}>GT</div><div style={{color:"#888"}}>Loading...</div></div>
    </div>
  );
  if(finishedWorkout) return <SummaryScreen workout={finishedWorkout} store={store} onDone={()=>{setFinishedWorkout(null);setActiveWorkout(null);}}/>;
  if(activeWorkout) return (
    <ActiveWorkout workout={activeWorkout} store={store}
      onFinish={(w)=>{ save({...store,workouts:[...store.workouts,w]}); setFinishedWorkout(w); }}
      onCancel={()=>setActiveWorkout(null)} onChange={(w)=>setActiveWorkout(w)}
    />
  );

  const TABS=[["home","Home"],["history","History"],["volume","Volume"],["split","Split"],["settings","Settings"]];
  return (
    <div style={{background:"#0f0f0f",minHeight:"100vh",fontFamily:"system-ui,-apple-system,sans-serif",color:"#fff",maxWidth:430,margin:"0 auto"}}>
      <div style={{background:"#121212",padding:"14px 16px 0",position:"sticky",top:0,zIndex:100,borderBottom:"1px solid #1e1e1e"}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:12}}>
          <span style={{fontWeight:800,fontSize:18,letterSpacing:-0.5,color:"#00e5ff"}}>GymTracker</span>
        </div>
        <div style={{display:"flex",gap:0,borderBottom:"2px solid #1e1e1e",overflowX:"auto"}}>
          {TABS.map(([k,l])=>(
            <button key={k} onClick={()=>setTab(k)} style={{
              flex:1,padding:"8px 4px",background:"none",border:"none",
              color:tab===k?"#00e5ff":"#555",fontWeight:tab===k?700:400,fontSize:12,cursor:"pointer",
              whiteSpace:"nowrap",minWidth:50,borderBottom:tab===k?"2px solid #00e5ff":"2px solid transparent",marginBottom:-2,transition:"all 0.15s"
            }}>{l}</button>
          ))}
        </div>
      </div>
      <div style={{padding:"16px 16px 80px"}}>
        <div style={{display:tab==="home"?"block":"none"}}><HomeTab store={store} save={save} onStart={setActiveWorkout}/></div>
        <div style={{display:tab==="history"?"block":"none"}}><HistoryTab store={store} save={save}/></div>
        <div style={{display:tab==="volume"?"block":"none"}}><VolumeTab store={store}/></div>
        <div style={{display:tab==="split"?"block":"none"}}><SplitTab store={store} save={save}/></div>
        <div style={{display:tab==="settings"?"block":"none"}}><SettingsTab store={store} save={save}/></div>
      </div>
    </div>
  );
}

// ── HOME TAB ───────────────────────────────────────────────────────────────────
function HomeTab({store,save,onStart}){
  const defGym=store.defaultGym||store.gyms[0]||"";
  const [selectedGym,setSelectedGym]=useState(defGym);
  const [showNew,setShowNew]=useState(false);
  const [newName,setNewName]=useState("");
  const [newTemplateGym,setNewTemplateGym]=useState(defGym);
  const [confirmDelete,setConfirmDelete]=useState(null);

  const gymTemplates=store.templates.filter(t=>(t.gym||store.gyms[0])===selectedGym);
  const nextPlan=getNextPlanInfo(store);

  function startFreeStyle(){
    onStart({id:"w"+Date.now(),type:"freestyle",name:"Freestyle Workout",gym:selectedGym,startTime:Date.now(),exercises:[],notes:""});
  }
  function startPlanned(plan){
    const exs=(plan.exercises||[]).map(te=>({exId:te.exId,sets:(te.sets||[{reps:10,weight:0}]).map(s=>({...s,done:false})),notes:""}));
    onStart({id:"w"+Date.now(),type:"planned",name:plan.dayLabel,gym:selectedGym,splitId:plan.splitId,plannedMuscles:plan.muscles||[],startTime:Date.now(),exercises:exs,notes:""});
  }
  function startTemplate(t){
    onStart({id:"w"+Date.now(),type:"template",name:t.name,templateId:t.id,gym:t.gym||selectedGym,startTime:Date.now(),
      exercises:t.exercises.map(te=>({exId:te.exId,sets:te.sets.map(s=>({...s,done:false})),notes:""})),notes:""});
  }
  function createTemplate(){
    if(!newName.trim()) return;
    save({...store,templates:[...store.templates,{id:"t"+Date.now(),name:newName.trim(),gym:newTemplateGym,exercises:[]}]});
    setNewName(""); setShowNew(false);
  }
  function deleteTemplate(id){ save({...store,templates:store.templates.filter(t=>t.id!==id)}); setConfirmDelete(null); }

  const fmtDate=(d)=>{
    const diff=Math.round((d-new Date())/(1000*60*60*24));
    if(diff===0) return "today"; if(diff===1) return "tomorrow";
    return d.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});
  };

  return (
    <div>
      <div style={{background:"#1a1a1a",borderRadius:12,padding:14,marginBottom:14,border:"1px solid #222"}}>
        <div style={{fontSize:11,color:"#666",marginBottom:8,textTransform:"uppercase",letterSpacing:1}}>Gym</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {store.gyms.map(g=>(
            <button key={g} onClick={()=>setSelectedGym(g)} style={{
              padding:"6px 14px",borderRadius:20,border:"1px solid",
              background:selectedGym===g?"#00e5ff22":"transparent",
              borderColor:selectedGym===g?"#00e5ff":"#333",
              color:selectedGym===g?"#00e5ff":"#777",fontSize:13,cursor:"pointer"
            }}>{g}</button>
          ))}
        </div>
      </div>

      <button onClick={startFreeStyle} style={{
        width:"100%",padding:"13px",background:"linear-gradient(135deg,#00e5ff18,#00ff8818)",
        border:"1px solid #00e5ff33",borderRadius:12,color:"#00e5ff",fontSize:15,fontWeight:600,cursor:"pointer",marginBottom:12
      }}>Start Freestyle Workout</button>

      {/* Active split today / next */}
      {nextPlan && (
        <div style={{marginBottom:16}}>
          <div style={{fontSize:11,color:"#888",marginBottom:8,textTransform:"uppercase",letterSpacing:1}}>
            {nextPlan.isToday ? "Today's Plan" : nextPlan.doneToday ? "Next Session" : "Upcoming"}
          </div>
          {nextPlan.plans.map((plan,i)=>(
            <div key={i} style={{background:"#1a1a1a",borderRadius:12,padding:"12px 14px",marginBottom:6,border:"1px solid #ff990033"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:3}}>
                    <span style={{fontWeight:700,fontSize:15,color:"#ffaa00"}}>{plan.dayLabel}</span>
                    {!nextPlan.isToday&&<span style={{fontSize:11,color:"#666"}}>{fmtDate(nextPlan.date)}</span>}
                  </div>
                  <div style={{fontSize:11,color:"#666"}}>{plan.splitName}</div>
                  {plan.muscles.length>0&&<div style={{fontSize:11,color:"#555",marginTop:2}}>{plan.muscles.map(m=>`${m.muscle} ${m.sets}`).join(" · ")}</div>}
                  {plan.exercises.length>0&&<div style={{fontSize:11,color:"#555",marginTop:1}}>{plan.exercises.map(e=>{const ex=store.exercises.find(x=>x.id===e.exId);return ex?ex.name:null;}).filter(Boolean).join(", ")}</div>}
                </div>
                {nextPlan.isToday&&(
                  <button onClick={()=>startPlanned(plan)} style={{background:"#ffaa0022",border:"1px solid #ffaa0055",color:"#ffaa00",borderRadius:8,padding:"7px 14px",fontWeight:700,cursor:"pointer",fontSize:13,flexShrink:0,marginLeft:8}}>Start</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {store.activeSplitId && !nextPlan && (
        <div style={{background:"#1a1a1a",borderRadius:12,padding:12,marginBottom:16,border:"1px solid #222",fontSize:13,color:"#555",textAlign:"center"}}>
          No upcoming sessions found in active split
        </div>
      )}

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <div style={{fontWeight:600,fontSize:15}}>Templates</div>
        <button onClick={()=>setShowNew(true)} style={{background:"#00e5ff",color:"#000",border:"none",borderRadius:8,padding:"6px 14px",fontSize:13,fontWeight:600,cursor:"pointer"}}>+ New</button>
      </div>

      {showNew && (
        <div style={{background:"#1a1a1a",borderRadius:12,padding:14,marginBottom:12,border:"1px solid #333"}}>
          <input value={newName} onChange={e=>setNewName(e.target.value)} placeholder="Template name..."
            style={{...inputStyle,marginBottom:10}} onKeyDown={e=>e.key==="Enter"&&createTemplate()}/>
          <div style={{fontSize:12,color:"#666",marginBottom:6}}>Gym</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
            {store.gyms.map(g=>(
              <button key={g} onClick={()=>setNewTemplateGym(g)} style={{
                padding:"5px 12px",borderRadius:16,border:"1px solid",fontSize:12,cursor:"pointer",
                background:newTemplateGym===g?"#00e5ff22":"transparent",
                borderColor:newTemplateGym===g?"#00e5ff":"#333",color:newTemplateGym===g?"#00e5ff":"#666"
              }}>{g}</button>
            ))}
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={createTemplate} style={{flex:1,background:"#00e5ff",color:"#000",border:"none",borderRadius:8,padding:"8px",fontWeight:600,cursor:"pointer"}}>Create</button>
            <button onClick={()=>setShowNew(false)} style={{flex:1,background:"#222",color:"#888",border:"none",borderRadius:8,padding:"8px",cursor:"pointer"}}>Cancel</button>
          </div>
        </div>
      )}

      {gymTemplates.length===0&&!showNew&&(
        <div style={{color:"#555",textAlign:"center",padding:"28px 0",fontSize:13}}>No templates for {selectedGym}</div>
      )}
      {gymTemplates.map(t=>(
        <TemplateCard key={t.id} template={t} store={store} save={save}
          onStart={()=>startTemplate(t)} onDelete={()=>setConfirmDelete(t.id)}/>
      ))}

      {confirmDelete && (
        <Modal onClose={()=>setConfirmDelete(null)}>
          <div style={{padding:20,textAlign:"center"}}>
            <div style={{fontWeight:700,fontSize:16,marginBottom:8}}>Delete Template?</div>
            <div style={{color:"#888",fontSize:13,marginBottom:20}}>This cannot be undone.</div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>deleteTemplate(confirmDelete)} style={{flex:1,background:"#ff4444",border:"none",borderRadius:8,padding:"10px",color:"#fff",fontWeight:700,cursor:"pointer"}}>Delete</button>
              <button onClick={()=>setConfirmDelete(null)} style={{flex:1,background:"#222",border:"none",borderRadius:8,padding:"10px",color:"#888",cursor:"pointer"}}>Cancel</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function TemplateCard({template,store,save,onStart,onDelete}){
  const [expanded,setExpanded]=useState(false);
  const [editEx,setEditEx]=useState(false);
  const [exSearch,setExSearch]=useState("");
  const exList=template.exercises.map(te=>store.exercises.find(e=>e.id===te.exId)).filter(Boolean);
  function addExercise(exId){
    const updated=store.templates.map(t=>t.id===template.id?{...t,exercises:[...t.exercises,{exId,sets:[{reps:10,weight:0}]}]}:t);
    save({...store,templates:updated});
  }
  function removeExercise(exId){
    const updated=store.templates.map(t=>t.id===template.id?{...t,exercises:t.exercises.filter(te=>te.exId!==exId)}:t);
    save({...store,templates:updated});
  }
  const filtered=store.exercises.filter(e=>e.name.toLowerCase().includes(exSearch.toLowerCase()));
  return (
    <div style={{background:"#1a1a1a",borderRadius:12,marginBottom:10,border:"1px solid #222",overflow:"hidden"}}>
      <div style={{padding:"12px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontWeight:600,fontSize:14}}>{template.name}</div>
          <div style={{fontSize:11,color:"#555",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{exList.map(e=>e.name).join(", ")||"No exercises"}</div>
        </div>
        <div style={{display:"flex",gap:8,flexShrink:0}}>
          <button onClick={()=>setExpanded(!expanded)} style={{background:"#222",border:"none",color:"#888",borderRadius:8,width:32,height:32,cursor:"pointer",fontSize:14}}>{expanded?"▲":"▼"}</button>
          <button onClick={onStart} style={{background:"#00e5ff",border:"none",color:"#000",borderRadius:8,padding:"0 14px",height:32,fontWeight:700,cursor:"pointer",fontSize:13}}>Start</button>
        </div>
      </div>
      {expanded && (
        <div style={{borderTop:"1px solid #222",padding:12}}>
          <div style={{fontSize:11,color:"#555",marginBottom:8}}>Gym: {template.gym||"—"}</div>
          {template.exercises.map(te=>{
            const ex=store.exercises.find(e=>e.id===te.exId); if(!ex) return null;
            return (
              <div key={te.exId} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid #1f1f1f"}}>
                <div>
                  <div style={{fontSize:13,fontWeight:500}}>{ex.name}</div>
                  <div style={{fontSize:11,color:"#555"}}>{te.sets.length} sets · {ex.equipment}</div>
                </div>
                <button onClick={()=>removeExercise(te.exId)} style={{background:"none",border:"none",color:"#ff4444",fontSize:18,cursor:"pointer",padding:"0 4px"}}>×</button>
              </div>
            );
          })}
          <button onClick={()=>setEditEx(!editEx)} style={{width:"100%",background:"#222",border:"1px dashed #444",color:"#888",borderRadius:8,padding:"8px",marginTop:10,cursor:"pointer",fontSize:13}}>
            {editEx?"Close":"+ Add Exercise"}
          </button>
          {editEx && (
            <div style={{marginTop:10}}>
              <input value={exSearch} onChange={e=>setExSearch(e.target.value)} placeholder="Search exercises..."
                style={{...inputStyle,marginBottom:8}}/>
              <div style={{maxHeight:180,overflowY:"auto"}}>
                {filtered.filter(e=>!template.exercises.find(te=>te.exId===e.id)).map(e=>(
                  <div key={e.id} onClick={()=>addExercise(e.id)} style={{padding:"8px 10px",borderRadius:8,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",background:"transparent"}}
                    onMouseEnter={ev=>ev.currentTarget.style.background="#222"} onMouseLeave={ev=>ev.currentTarget.style.background="transparent"}>
                    <div><div style={{fontSize:13}}>{e.name}</div><div style={{fontSize:11,color:"#555"}}>{e.primary} · {e.equipment}</div></div>
                    <span style={{color:"#00e5ff",fontSize:18}}>+</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <button onClick={onDelete} style={{width:"100%",background:"none",border:"1px solid #ff444433",color:"#ff6666",borderRadius:8,padding:"8px",marginTop:8,cursor:"pointer",fontSize:12}}>Delete Template</button>
        </div>
      )}
    </div>
  );
}

// ── ACTIVE WORKOUT ─────────────────────────────────────────────────────────────
function ActiveWorkout({workout,store,onFinish,onCancel,onChange}){
  const [elapsed,setElapsed]=useState(0);
  const [showAddEx,setShowAddEx]=useState(false);
  const [exSearch,setExSearch]=useState("");
  const [selectedEx,setSelectedEx]=useState(null);
  const [showFinishWarning,setShowFinishWarning]=useState(false);
  const [showNotes,setShowNotes]=useState(false);
  const [restTimer,setRestTimer]=useState(null);
  const [volumeWarning,setVolumeWarning]=useState(null);
  const intervalRef=useRef();
  const restIntervalRef=useRef();

  const plannedMuscles=workout.plannedMuscles||[];
  const actualMuscleSets={};
  if(plannedMuscles.length>0){
    workout.exercises.forEach(we=>{
      const ex=store.exercises.find(e=>e.id===we.exId); if(!ex) return;
      const done=we.sets.filter(s=>s.done).length;
      actualMuscleSets[ex.primary]=(actualMuscleSets[ex.primary]||0)+done;
    });
  }
  useEffect(()=>{ intervalRef.current=setInterval(()=>setElapsed(Math.floor((Date.now()-workout.startTime)/1000)),1000); return ()=>clearInterval(intervalRef.current); },[workout.startTime]);
  useEffect(()=>()=>clearInterval(restIntervalRef.current),[]);

  function startRestTimer(){ clearInterval(restIntervalRef.current); const total=store.defaultRestTime||150; setRestTimer({remaining:total,total}); restIntervalRef.current=setInterval(()=>{ setRestTimer(t=>{ if(!t){clearInterval(restIntervalRef.current);return null;} const next=t.remaining-1; if(next<=0){clearInterval(restIntervalRef.current);return null;} return {...t,remaining:next}; }); },1000); }
  function adjustRestTimer(delta){ setRestTimer(t=>t?{...t,remaining:Math.max(5,t.remaining+delta),total:Math.max(t.total,t.remaining+delta)}:null); }
  function dismissRestTimer(){ clearInterval(restIntervalRef.current); setRestTimer(null); }

  function updateSet(exIdx,setIdx,field,value){ const exercises=[...workout.exercises]; exercises[exIdx]={...exercises[exIdx],sets:[...exercises[exIdx].sets]}; exercises[exIdx].sets[setIdx]={...exercises[exIdx].sets[setIdx],[field]:value}; onChange({...workout,exercises}); }
  function toggleSetDone(exIdx,setIdx){ const exercises=[...workout.exercises]; exercises[exIdx]={...exercises[exIdx],sets:[...exercises[exIdx].sets]}; const s=exercises[exIdx].sets[setIdx]; const nowDone=!s.done; exercises[exIdx].sets[setIdx]={...s,done:nowDone}; onChange({...workout,exercises}); if(nowDone) startRestTimer(); }
  function addSet(exIdx){ const exercises=[...workout.exercises]; const last=exercises[exIdx].sets[exercises[exIdx].sets.length-1]||{reps:10,weight:0}; exercises[exIdx]={...exercises[exIdx],sets:[...exercises[exIdx].sets,{...last,done:false}]}; onChange({...workout,exercises}); }
  function removeSet(exIdx,setIdx){ const exercises=[...workout.exercises]; exercises[exIdx]={...exercises[exIdx],sets:exercises[exIdx].sets.filter((_,i)=>i!==setIdx)}; onChange({...workout,exercises}); }
  function updateExNotes(exIdx,notes){ const exercises=[...workout.exercises]; exercises[exIdx]={...exercises[exIdx],notes}; onChange({...workout,exercises}); }
  function addExercise(exId){ const prev=getPreviousSets(exId,workout.gym,store); const def=prev.length>0?{...prev[0],done:false}:{reps:10,weight:0,done:false}; onChange({...workout,exercises:[...workout.exercises,{exId,sets:[def,{...def},{...def}],notes:""}]}); setShowAddEx(false); }
  function removeExercise(idx){ onChange({...workout,exercises:workout.exercises.filter((_,i)=>i!==idx)}); }
  function tryFinish(){
    const hasUnticked=workout.exercises.some(we=>we.sets.some(s=>!s.done)); if(hasUnticked){ setShowFinishWarning(true); return; }
    if(plannedMuscles.length>0){
      const under=plannedMuscles.filter(({muscle,sets})=>{ const actual=actualMuscleSets[muscle]||0; const target=parseFloat(sets)||0; return target>0&&actual<target-1; });
      if(under.length>0){ setVolumeWarning(under.map(({muscle,sets})=>({muscle,planned:parseFloat(sets)||0,actual:actualMuscleSets[muscle]||0}))); return; }
    }
    doFinish(workout);
  }
  function doFinish(w){ onFinish({...w,endTime:Date.now(),duration:elapsed}); }
  function finishDiscardUnticked(){ const exercises=workout.exercises.map(we=>({...we,sets:we.sets.filter(s=>s.done)})).filter(we=>we.sets.length>0); doFinish({...workout,exercises}); setShowFinishWarning(false); }
  function finishMarkAllDone(){ const exercises=workout.exercises.map(we=>({...we,sets:we.sets.map(s=>({...s,done:true}))})); doFinish({...workout,exercises}); setShowFinishWarning(false); }

  const filtered=store.exercises.filter(e=>e.name.toLowerCase().includes(exSearch.toLowerCase()));
  return (
    <div style={{background:"#0f0f0f",minHeight:"100vh",fontFamily:"system-ui,-apple-system,sans-serif",color:"#fff",maxWidth:430,margin:"0 auto"}}>
      <div style={{background:"#121212",padding:"12px 14px",position:"sticky",top:0,zIndex:100,borderBottom:"1px solid #1e1e1e"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
          <div>
            <div style={{fontWeight:700,fontSize:15}}>{workout.name}</div>
            <div style={{fontSize:12,color:"#888"}}>{workout.gym} · {formatDuration(elapsed)}</div>
          </div>
          <div style={{display:"flex",gap:6}}>
            <button onClick={()=>setShowNotes(!showNotes)} style={{background:"#222",border:"none",color:workout.notes?"#00e5ff":"#888",borderRadius:8,padding:"6px 10px",fontSize:12,cursor:"pointer"}}>Notes</button>
            <button onClick={onCancel} style={{background:"#222",border:"none",color:"#888",borderRadius:8,padding:"6px 12px",fontSize:13,cursor:"pointer"}}>Cancel</button>
            <button onClick={tryFinish} style={{background:"#00e5ff",border:"none",color:"#000",borderRadius:8,padding:"6px 14px",fontSize:13,fontWeight:700,cursor:"pointer"}}>Finish</button>
          </div>
        </div>
        {showNotes&&<textarea value={workout.notes||""} onChange={e=>onChange({...workout,notes:e.target.value})} placeholder="Workout notes..." style={{...inputStyle,marginTop:8,height:60,resize:"none",fontSize:13}}/>}
        {plannedMuscles.length>0&&(
          <div style={{display:"flex",gap:10,flexWrap:"wrap",paddingTop:8,marginTop:4,borderTop:"1px solid #1e1e1e"}}>
            {plannedMuscles.map(({muscle,sets})=>{
              const actual=actualMuscleSets[muscle]||0; const target=parseFloat(sets)||0;
              const green=target>0&&actual>=target-1; const col=green?"#00cc44":actual>0?"#ffaa00":"#555";
              return <span key={muscle} style={{fontSize:11,color:col,fontWeight:green?700:400}}>{muscle} {actual}/{target}</span>;
            })}
          </div>
        )}
      </div>

      <div style={{padding:"12px 14px 80px"}}>
        {workout.exercises.map((we,exIdx)=>{
          const ex=store.exercises.find(e=>e.id===we.exId); if(!ex) return null;
          const prevSets=getPreviousSets(ex.id,workout.gym,store);
          const allDone=we.sets.length>0&&we.sets.every(s=>s.done);
          return (
            <div key={exIdx} style={{background:"#1a1a1a",borderRadius:12,marginBottom:14,border:`1px solid ${allDone?"#00e5ff33":"#222"}`,overflow:"hidden"}}>
              <div style={{padding:"10px 12px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div onClick={()=>setSelectedEx(ex)} style={{cursor:"pointer",flex:1}}>
                  <div style={{fontWeight:600,color:"#00e5ff",fontSize:14}}>{ex.name}</div>
                  <div style={{fontSize:11,color:"#555"}}>{ex.primary} · {ex.equipment}</div>
                </div>
                <button onClick={()=>removeExercise(exIdx)} style={{background:"none",border:"none",color:"#444",fontSize:20,cursor:"pointer",padding:"0 4px"}}>×</button>
              </div>
              <div style={{padding:"0 12px 10px"}}>
                <div style={{display:"grid",gridTemplateColumns:"22px 28px 1fr 1fr 1fr 34px",gap:4,marginBottom:5}}>
                  <div/><div style={{fontSize:10,color:"#555",textAlign:"center"}}>SET</div>
                  <div style={{fontSize:10,color:"#555",textAlign:"center"}}>PREV</div>
                  <div style={{fontSize:10,color:"#555",textAlign:"center"}}>KG</div>
                  <div style={{fontSize:10,color:"#555",textAlign:"center"}}>REPS</div><div/>
                </div>
                {we.sets.map((s,si)=>{
                  const prev=prevSets[si]||prevSets[prevSets.length-1];
                  const prevStr=prev&&(prev.weight||prev.reps)?`${prev.weight||0}×${prev.reps||0}`:"—";
                  return (
                    <div key={si} style={{display:"grid",gridTemplateColumns:"22px 28px 1fr 1fr 1fr 34px",gap:4,marginBottom:4,background:s.done?"#0d2416":"transparent",borderRadius:s.done?7:4,padding:s.done?"2px 4px":"0"}}>
                      <button onClick={()=>removeSet(exIdx,si)} style={{background:"none",border:"none",color:"#2a2a2a",fontSize:16,cursor:"pointer",padding:0,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"center",background:"#111",border:"1px solid #2a2a2a",borderRadius:6,height:36,fontSize:12,color:"#555"}}>{si+1}</div>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"center",background:"#111",border:"1px solid #1e1e1e",borderRadius:6,height:36,fontSize:11,color:"#444",textAlign:"center",padding:"0 2px"}}>{prevStr}</div>
                      <div>
                        <input type="number" inputMode="decimal" value={s.weight||""} onChange={e=>{ const n=parseFloat(e.target.value); updateSet(exIdx,si,"weight",isNaN(n)?0:n); }} style={{width:"100%",background:"#111",border:"1px solid #2a2a2a",borderRadius:6,padding:"8px 0",color:"#fff",fontSize:14,textAlign:"center",boxSizing:"border-box",height:36}}/>
                      </div>
                      <div>
                        <input type="number" inputMode="numeric" value={s.reps||""} onChange={e=>updateSet(exIdx,si,"reps",parseInt(e.target.value)||0)} style={{width:"100%",background:"#111",border:"1px solid #2a2a2a",borderRadius:6,padding:"8px 0",color:"#fff",fontSize:14,textAlign:"center",boxSizing:"border-box",height:36}}/>
                      </div>
                      <button onClick={()=>toggleSetDone(exIdx,si)} style={{background:s.done?"#00cc4433":"#1e1e1e",border:`1px solid ${s.done?"#00cc44":"#333"}`,borderRadius:6,color:s.done?"#00cc44":"#333",fontWeight:700,fontSize:14,cursor:"pointer",height:36,display:"flex",alignItems:"center",justifyContent:"center"}}>{s.done?"✓":""}</button>
                    </div>
                  );
                })}
                <button onClick={()=>addSet(exIdx)} style={{width:"100%",background:"#111",border:"1px dashed #2a2a2a",borderRadius:8,color:"#555",padding:"5px",fontSize:12,cursor:"pointer",marginTop:2}}>+ Set</button>
                <ExNotes notes={we.notes||""} onChange={n=>updateExNotes(exIdx,n)}/>
              </div>
            </div>
          );
        })}
        <button onClick={()=>setShowAddEx(!showAddEx)} style={{width:"100%",background:"#1a1a1a",border:"1px dashed #333",borderRadius:12,color:"#888",padding:"14px",fontSize:14,cursor:"pointer"}}>+ Add Exercise</button>
        {showAddEx && (
          <div style={{background:"#1a1a1a",borderRadius:12,padding:12,marginTop:8,border:"1px solid #222"}}>
            <input value={exSearch} onChange={e=>setExSearch(e.target.value)} placeholder="Search exercises..." style={{...inputStyle,marginBottom:8}}/>
            <div style={{maxHeight:220,overflowY:"auto"}}>
              {filtered.map(e=>(
                <div key={e.id} onClick={()=>addExercise(e.id)} style={{padding:"8px 10px",cursor:"pointer",borderRadius:8,display:"flex",justifyContent:"space-between",background:"transparent"}}
                  onMouseEnter={ev=>ev.currentTarget.style.background="#222"} onMouseLeave={ev=>ev.currentTarget.style.background="transparent"}>
                  <div><div style={{fontSize:13}}>{e.name}</div><div style={{fontSize:11,color:"#555"}}>{e.primary} · {e.equipment}</div></div>
                  <span style={{color:"#00e5ff",fontSize:18}}>+</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {restTimer&&<RestTimerBar timer={restTimer} onAdjust={adjustRestTimer} onDismiss={dismissRestTimer}/>}
      {selectedEx&&<ExerciseModal ex={selectedEx} workout={workout} store={store} onClose={()=>setSelectedEx(null)}/>}
      {showFinishWarning&&(
        <Modal onClose={()=>setShowFinishWarning(false)}>
          <div style={{padding:20}}>
            <div style={{fontWeight:700,fontSize:16,marginBottom:6}}>Unfinished Sets</div>
            <div style={{color:"#888",fontSize:13,marginBottom:20}}>Some sets haven't been ticked. What would you like to do?</div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <button onClick={finishDiscardUnticked} style={{background:"#ff444422",border:"1px solid #ff444455",borderRadius:8,padding:"10px",color:"#ff6666",fontWeight:600,cursor:"pointer",fontSize:14}}>Discard unticked sets</button>
              <button onClick={finishMarkAllDone} style={{background:"#00e5ff22",border:"1px solid #00e5ff55",borderRadius:8,padding:"10px",color:"#00e5ff",fontWeight:600,cursor:"pointer",fontSize:14}}>Mark all as done</button>
              <button onClick={()=>setShowFinishWarning(false)} style={{background:"#222",border:"none",borderRadius:8,padding:"10px",color:"#888",cursor:"pointer",fontSize:14}}>Go back</button>
            </div>
          </div>
        </Modal>
      )}
      {volumeWarning&&(
        <Modal onClose={()=>setVolumeWarning(null)}>
          <div style={{padding:20}}>
            <div style={{fontWeight:700,fontSize:16,marginBottom:6}}>Low Volume Warning</div>
            <div style={{color:"#888",fontSize:13,marginBottom:14}}>You're short on planned volume for:</div>
            <div style={{marginBottom:18}}>
              {volumeWarning.map(({muscle,planned,actual})=>(
                <div key={muscle} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"7px 0",borderBottom:"1px solid #1e1e1e"}}>
                  <span style={{fontSize:14,color:"#fff"}}>{muscle}</span>
                  <span style={{fontSize:13,color:"#ff8844"}}>{actual}/{planned} sets · need {planned-actual} more</span>
                </div>
              ))}
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              <button onClick={()=>setVolumeWarning(null)} style={{background:"#1a1a1a",border:"1px solid #333",borderRadius:8,padding:"10px",color:"#888",cursor:"pointer",fontSize:14}}>Go back & add sets</button>
              <button onClick={()=>{setVolumeWarning(null);doFinish(workout);}} style={{background:"#ff444422",border:"1px solid #ff444455",borderRadius:8,padding:"10px",color:"#ff6666",fontWeight:600,cursor:"pointer",fontSize:14}}>Finish anyway</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ExNotes({notes,onChange}){
  const [open,setOpen]=useState(!!notes);
  return (
    <div style={{marginTop:6}}>
      {!open?<button onClick={()=>setOpen(true)} style={{background:"none",border:"none",color:"#444",fontSize:12,cursor:"pointer",padding:0}}>+ Exercise note</button>
        :<textarea value={notes} onChange={e=>onChange(e.target.value)} placeholder="Note for this exercise..." style={{...inputStyle,height:48,resize:"none",fontSize:12,marginTop:4}}/>}
    </div>
  );
}

function RestTimerBar({timer,onAdjust,onDismiss}){
  const pct=Math.round((timer.remaining/timer.total)*100);
  const mins=Math.floor(timer.remaining/60); const secs=timer.remaining%60;
  const col=pct>50?"#00e5ff":pct>25?"#ffaa00":"#ff4444";
  return (
    <div style={{position:"fixed",bottom:0,left:"50%",transform:"translateX(-50%)",width:"100%",maxWidth:430,background:"#1a1a1a",borderTop:"1px solid #2a2a2a",padding:"10px 16px 24px",zIndex:200}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
        <span style={{fontSize:12,color:"#666",fontWeight:600,textTransform:"uppercase",letterSpacing:0.5}}>Rest</span>
        <span style={{fontSize:22,fontWeight:800,color:col,fontVariantNumeric:"tabular-nums"}}>{mins}:{String(secs).padStart(2,"0")}</span>
        <button onClick={onDismiss} style={{background:"none",border:"none",color:"#444",fontSize:18,cursor:"pointer",padding:"0 4px",lineHeight:1}}>✕</button>
      </div>
      <div style={{height:4,background:"#2a2a2a",borderRadius:2,marginBottom:10,overflow:"hidden"}}>
        <div style={{height:4,background:col,borderRadius:2,width:`${pct}%`,transition:"width 0.9s linear"}}/>
      </div>
      <div style={{display:"flex",gap:8}}>
        <button onClick={()=>onAdjust(-10)} style={{flex:1,background:"#222",border:"1px solid #333",borderRadius:8,padding:"8px",color:"#aaa",cursor:"pointer",fontSize:14,fontWeight:600}}>−10s</button>
        <button onClick={()=>onAdjust(10)} style={{flex:1,background:"#222",border:"1px solid #333",borderRadius:8,padding:"8px",color:"#aaa",cursor:"pointer",fontSize:14,fontWeight:600}}>+10s</button>
      </div>
    </div>
  );
}

// ── EXERCISE MODAL ─────────────────────────────────────────────────────────────
function ExerciseModal({ex,workout,store,onClose}){
  const [tab,setTab]=useState("records");
  const records=getRecordsForExercise(ex.id,store);
  const gym=workout?workout.gym:null;
  const history=store.workouts.filter(w=>(!gym||w.gym===gym)&&w.exercises.some(we=>we.exId===ex.id)).sort((a,b)=>b.startTime-a.startTime).slice(0,10);
  return (
    <Modal onClose={onClose}>
      <div style={{padding:"16px 16px 20px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:14}}>
          <div>
            <div style={{fontWeight:700,fontSize:16}}>{ex.name}</div>
            <div style={{fontSize:12,color:"#666",marginTop:2}}>{ex.primary} · {ex.equipment}{gym?` · ${gym}`:""}</div>
          </div>
          <button onClick={onClose} style={{background:"#222",border:"none",color:"#888",borderRadius:20,width:30,height:30,fontSize:16,cursor:"pointer"}}>×</button>
        </div>
        <div style={{display:"flex",gap:0,borderBottom:"1px solid #222",marginBottom:14}}>
          {[["records","Records"],["history","History"]].map(([k,l])=>(
            <button key={k} onClick={()=>setTab(k)} style={{flex:1,padding:"7px 0",background:"none",border:"none",color:tab===k?"#00e5ff":"#555",fontWeight:tab===k?700:400,fontSize:13,cursor:"pointer",borderBottom:tab===k?"2px solid #00e5ff":"2px solid transparent",marginBottom:-1}}>{l}</button>
          ))}
        </div>
        {tab==="records"&&(
          <div>
            <div style={{fontSize:11,color:"#555",marginBottom:8}}>Best weight per rep count · 1RM estimate</div>
            {Array.from({length:20},(_,i)=>i+1).map(reps=>{
              const r=records[reps];
              return (
                <div key={reps} style={{display:"grid",gridTemplateColumns:"50px 1fr 1fr 60px",alignItems:"center",padding:"5px 0",borderBottom:"1px solid #1a1a1a",gap:4}}>
                  <span style={{fontSize:12,color:"#777"}}>{reps} rep{reps>1?"s":""}</span>
                  {r?<>
                    <span style={{fontSize:14,fontWeight:600}}>{r.weight} kg</span>
                    <span style={{fontSize:10,color:"#555",lineHeight:1.3}}>{new Date(r.date).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"2-digit"})}<br/>{r.gym}</span>
                    <span style={{fontSize:11,color:"#00e5ff",textAlign:"right"}}>{calc1RM(r.weight,reps).toFixed(1)}kg</span>
                  </>:<span style={{fontSize:12,color:"#2a2a2a",gridColumn:"2/5"}}>—</span>}
                </div>
              );
            })}
          </div>
        )}
        {tab==="history"&&(
          <div>
            {history.length===0&&<div style={{color:"#555",textAlign:"center",padding:20,fontSize:13}}>No history yet{gym?` at ${gym}`:""}</div>}
            {history.map(w=>(
              <div key={w.id} style={{borderBottom:"1px solid #1e1e1e",paddingBottom:10,marginBottom:10}}>
                <div style={{fontSize:11,color:"#888",marginBottom:5}}>{new Date(w.startTime).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})} · {w.gym}</div>
                {w.exercises.find(we=>we.exId===ex.id)?.sets.map((s,i)=>(
                  <div key={i} style={{display:"flex",gap:12,fontSize:13,color:"#ccc",marginBottom:2}}>
                    <span style={{color:"#555",width:40}}>Set {i+1}</span><span>{s.weight} kg</span><span style={{color:"#555"}}>×</span><span>{s.reps} reps</span>
                    {s.weight&&s.reps?<span style={{color:"#00e5ff",marginLeft:"auto"}}>{calc1RM(s.weight,s.reps).toFixed(1)}kg</span>:null}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── SUMMARY SCREEN ─────────────────────────────────────────────────────────────
function SummaryScreen({workout,store,onDone}){
  const duration=workout.duration||Math.floor((workout.endTime-workout.startTime)/1000);
  const doneSets=workout.exercises.reduce((a,we)=>a+we.sets.filter(s=>s.done).length,0);
  const totalVol=workout.exercises.reduce((a,we)=>a+we.sets.filter(s=>s.done).reduce((s2,s)=>s2+(s.weight||0)*(s.reps||0),0),0);
  const muscleMap={};
  workout.exercises.forEach(we=>{
    const ex=store.exercises.find(e=>e.id===we.exId); if(!ex) return;
    const s=we.sets.filter(x=>x.done).length; if(s===0) return;
    muscleMap[ex.primary]=(muscleMap[ex.primary]||0)+s;
    const sw=store.secondaryWeights[ex.id]||{};
    ex.secondary.forEach(m=>{ const w=sw[m]!==undefined?sw[m]:0.5; if(w>0) muscleMap[m]=(muscleMap[m]||0)+(s*w); });
  });
  return (
    <div style={{background:"#0f0f0f",minHeight:"100vh",fontFamily:"system-ui,-apple-system,sans-serif",color:"#fff",maxWidth:430,margin:"0 auto",padding:20}}>
      <div style={{textAlign:"center",marginBottom:24}}>
        <div style={{fontSize:22,fontWeight:800,marginBottom:4}}>Workout Complete</div>
        <div style={{color:"#888",fontSize:14}}>{workout.name} · {workout.gym}</div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:18}}>
        {[["Duration",formatDuration(duration)],["Sets",doneSets],["Volume",Math.round(totalVol)+"kg"]].map(([label,val])=>(
          <div key={label} style={{background:"#1a1a1a",borderRadius:12,padding:"12px 6px",textAlign:"center",border:"1px solid #222"}}>
            <div style={{fontWeight:700,fontSize:18}}>{val}</div><div style={{fontSize:11,color:"#666",marginTop:2}}>{label}</div>
          </div>
        ))}
      </div>
      {Object.keys(muscleMap).length>0&&(
        <div style={{background:"#1a1a1a",borderRadius:12,padding:14,marginBottom:16,border:"1px solid #222"}}>
          <div style={{fontWeight:600,marginBottom:10,fontSize:14}}>Muscle Volume</div>
          {Object.entries(muscleMap).sort((a,b)=>b[1]-a[1]).map(([m,s])=>(
            <div key={m} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid #1a1a1a",fontSize:13}}>
              <span style={{color:"#ccc"}}>{m}</span><span style={{color:"#00e5ff",fontWeight:600}}>{s.toFixed(1)} sets</span>
            </div>
          ))}
        </div>
      )}
      <div style={{background:"#1a1a1a",borderRadius:12,padding:14,marginBottom:20,border:"1px solid #222"}}>
        <div style={{fontWeight:600,marginBottom:10,fontSize:14}}>Exercises</div>
        {workout.exercises.map((we,i)=>{
          const ex=store.exercises.find(e=>e.id===we.exId); if(!ex) return null;
          const ds=we.sets.filter(s=>s.done);
          const best1RM=ds.length?Math.max(...ds.map(s=>calc1RM(s.weight||0,s.reps||0))):0;
          return (
            <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid #1a1a1a",fontSize:13}}>
              <span>{ex.name}</span><span style={{color:"#888"}}>{ds.length} sets{best1RM>0?` · 1RM ~${best1RM.toFixed(0)}kg`:""}</span>
            </div>
          );
        })}
      </div>
      <button onClick={onDone} style={{width:"100%",background:"#00e5ff",border:"none",borderRadius:12,padding:14,color:"#000",fontWeight:700,fontSize:16,cursor:"pointer"}}>Done</button>
    </div>
  );
}

// ── HISTORY TAB ────────────────────────────────────────────────────────────────
function HistoryTab({store,save}){
  const [view,setView]=useState("list");
  const [selectedDate,setSelectedDate]=useState(null);
  const [currentMonth,setCurrentMonth]=useState(()=>{const d=new Date();return{y:d.getFullYear(),m:d.getMonth()};});

  const workoutsByDate={};
  store.workouts.forEach(w=>{const d=dateKey(w.startTime);if(!workoutsByDate[d])workoutsByDate[d]=[];workoutsByDate[d].push(w);});

  function CalendarView(){
    const {y,m}=currentMonth;
    const firstDay=new Date(y,m,1).getDay();
    const daysInMonth=new Date(y,m+1,0).getDate();
    const cells=[]; for(let i=0;i<(firstDay===0?6:firstDay-1);i++) cells.push(null);
    for(let d=1;d<=daysInMonth;d++) cells.push(d);
    const monthNames=["January","February","March","April","May","June","July","August","September","October","November","December"];
    const todayStr=new Date().toISOString().slice(0,10);
    return (
      <div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <button onClick={()=>setCurrentMonth(p=>{const d=new Date(p.y,p.m-1,1);return{y:d.getFullYear(),m:d.getMonth()};})} style={{background:"#1a1a1a",border:"none",color:"#fff",borderRadius:8,width:34,height:34,cursor:"pointer",fontSize:16}}>‹</button>
          <div style={{fontWeight:600,fontSize:15}}>{monthNames[m]} {y}</div>
          <button onClick={()=>setCurrentMonth(p=>{const d=new Date(p.y,p.m+1,1);return{y:d.getFullYear(),m:d.getMonth()};})} style={{background:"#1a1a1a",border:"none",color:"#fff",borderRadius:8,width:34,height:34,cursor:"pointer",fontSize:16}}>›</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3,marginBottom:3}}>
          {["Mo","Tu","We","Th","Fr","Sa","Su"].map(d=><div key={d} style={{textAlign:"center",fontSize:10,color:"#555",padding:"3px 0"}}>{d}</div>)}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3}}>
          {cells.map((d,i)=>{
            if(!d) return <div key={i}/>;
            const key=`${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
            const hasWorkout=!!workoutsByDate[key];
            const jsDate=new Date(y,m,d);
            const plans=store.activeSplitId?getPlannedForDate(jsDate,store):[];
            const hasPlanned=plans.length>0&&!hasWorkout;
            const isSelected=selectedDate===key; const isToday=todayStr===key;
            return (
              <button key={i} onClick={()=>setSelectedDate(isSelected?null:key)} style={{
                aspectRatio:"1",borderRadius:8,border:isToday?"2px solid #00e5ff":"1px solid transparent",
                background:isSelected?"#00e5ff22":hasWorkout?"#00441a":hasPlanned?"#2a1a00":"#1a1a1a",
                color:hasWorkout?"#00cc55":hasPlanned?"#ffaa00":isToday?"#00e5ff":"#555",
                fontWeight:hasWorkout||hasPlanned||isToday?700:400,cursor:"pointer",fontSize:12,position:"relative",padding:0
              }}>
                {d}
                {hasWorkout&&<div style={{position:"absolute",bottom:2,left:"50%",transform:"translateX(-50%)",width:4,height:4,borderRadius:"50%",background:"#00cc55"}}/>}
                {hasPlanned&&<div style={{position:"absolute",bottom:2,left:"50%",transform:"translateX(-50%)",width:4,height:4,borderRadius:"50%",background:"#ffaa00"}}/>}
              </button>
            );
          })}
        </div>
        <div style={{display:"flex",gap:14,marginTop:10,fontSize:11,color:"#555"}}>
          <span><span style={{color:"#00cc55"}}>■</span> Completed</span>
          <span><span style={{color:"#ffaa00"}}>■</span> Planned</span>
          <span><span style={{color:"#00e5ff"}}>○</span> Today</span>
        </div>
        {selectedDate&&(
          <div style={{marginTop:14}}>
            {workoutsByDate[selectedDate]
              ? workoutsByDate[selectedDate].map(w=><WorkoutCard key={w.id} workout={w} store={store} save={save}/>)
              : (()=>{
                  const jsDate=new Date(selectedDate+"T12:00:00");
                  const plans=store.activeSplitId?getPlannedForDate(jsDate,store):[];
                  return plans.length>0?plans.map((p,i)=>(
                    <div key={i} style={{background:"#1a1a1a",borderRadius:12,padding:"12px 14px",marginBottom:8,border:"1px solid #ff990033"}}>
                      <div style={{fontWeight:600,color:"#ffaa00"}}>{p.dayLabel}</div>
                      <div style={{fontSize:12,color:"#666",marginTop:2}}>{p.splitName}</div>
                      {p.muscles.length>0&&(
                        <div style={{display:"flex",flexWrap:"wrap",gap:5,marginTop:8}}>
                          {p.muscles.map(m=>(
                            <span key={m.muscle} style={{background:"#111",borderRadius:6,padding:"2px 8px",fontSize:11,color:"#888"}}>{m.muscle} · {m.sets} sets</span>
                          ))}
                        </div>
                      )}
                      {p.exercises.length>0&&(
                        <div style={{marginTop:10,borderTop:"1px solid #222",paddingTop:8}}>
                          <div style={{fontSize:10,color:"#555",marginBottom:6,textTransform:"uppercase",letterSpacing:0.5}}>Planned exercises</div>
                          {p.exercises.map(e=>{
                            const ex=store.exercises.find(x=>x.id===e.exId);
                            if(!ex) return null;
                            const setCount=(e.sets||[]).length;
                            return (
                              <div key={e.exId} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:"1px solid #1e1e1e"}}>
                                <div>
                                  <div style={{fontSize:13,color:"#ddd"}}>{ex.name}</div>
                                  <div style={{fontSize:11,color:"#555"}}>{ex.primary} · {ex.equipment}</div>
                                </div>
                                <span style={{fontSize:12,color:"#00e5ff",fontWeight:600}}>{setCount} sets</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )):null;
                })()
            }
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div style={{display:"flex",gap:8,marginBottom:14}}>
        {[["list","List"],["calendar","Calendar"]].map(([k,l])=>(
          <button key={k} onClick={()=>setView(k)} style={{flex:1,padding:"8px",borderRadius:10,border:"1px solid",background:view===k?"#00e5ff22":"transparent",borderColor:view===k?"#00e5ff":"#333",color:view===k?"#00e5ff":"#666",fontSize:13,cursor:"pointer"}}>{l}</button>
        ))}
      </div>
      {view==="calendar"?<CalendarView/>:(
        <div>
          {store.workouts.length===0&&<div style={{color:"#555",textAlign:"center",padding:40,fontSize:13}}>No workouts yet</div>}
          {[...store.workouts].sort((a,b)=>b.startTime-a.startTime).map(w=><WorkoutCard key={w.id} workout={w} store={store} save={save}/>)}
        </div>
      )}
    </div>
  );
}

function WorkoutCard({workout,store,save}){
  const [open,setOpen]=useState(false);
  const [editGym,setEditGym]=useState(false);
  const dur=workout.duration||Math.floor(((workout.endTime||Date.now())-workout.startTime)/1000);
  const sets=workout.exercises.reduce((a,we)=>a+we.sets.filter(s=>s.done!==false).length,0);
  function changeGym(g){ save({...store,workouts:store.workouts.map(w=>w.id===workout.id?{...w,gym:g}:w)}); setEditGym(false); }
  return (
    <div style={{background:"#1a1a1a",borderRadius:12,marginBottom:10,border:"1px solid #222",overflow:"hidden"}}>
      <div style={{padding:"11px 13px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}} onClick={()=>setOpen(!open)}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontWeight:600,fontSize:14}}>{workout.name}</div>
          <div style={{fontSize:11,color:"#666",marginTop:2}}>{new Date(workout.startTime).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})} · {workout.gym} · {formatDuration(dur)} · {sets} sets</div>
        </div>
        <span style={{color:"#444",fontSize:12,marginLeft:8}}>{open?"▲":"▼"}</span>
      </div>
      {open&&(
        <div style={{borderTop:"1px solid #1e1e1e",padding:12}}>
          <button onClick={e=>{e.stopPropagation();setEditGym(!editGym);}} style={{background:"#222",border:"none",color:"#888",borderRadius:6,padding:"4px 10px",fontSize:11,cursor:"pointer",marginBottom:8}}>Change gym</button>
          {editGym&&(
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
              {store.gyms.map(g=>(
                <button key={g} onClick={()=>changeGym(g)} style={{padding:"4px 10px",borderRadius:14,border:"1px solid",fontSize:12,cursor:"pointer",background:workout.gym===g?"#00e5ff22":"transparent",borderColor:workout.gym===g?"#00e5ff":"#333",color:workout.gym===g?"#00e5ff":"#666"}}>{g}</button>
              ))}
            </div>
          )}
          {workout.notes&&<div style={{fontSize:12,color:"#888",marginBottom:10,fontStyle:"italic"}}>"{workout.notes}"</div>}
          {workout.exercises.map((we,i)=>{
            const ex=store.exercises.find(e=>e.id===we.exId); if(!ex) return null;
            const ds=we.sets.filter(s=>s.done!==false);
            return (
              <div key={i} style={{marginBottom:8}}>
                <div style={{fontSize:13,fontWeight:500,color:"#00e5ff",marginBottom:3}}>{ex.name}</div>
                {ds.map((s,si)=><div key={si} style={{fontSize:12,color:"#777",marginLeft:8}}>Set {si+1}: {s.weight}kg × {s.reps}</div>)}
                {we.notes&&<div style={{fontSize:11,color:"#555",marginLeft:8,fontStyle:"italic",marginTop:2}}>"{we.notes}"</div>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── VOLUME TAB ─────────────────────────────────────────────────────────────────
function VolumeTab({store}){
  const [view,setView]=useState("history");
  const [selectedMuscle,setSelectedMuscle]=useState("Chest");
  const allDates=store.workouts.map(w=>w.startTime);
  if(!allDates.length) return <div style={{color:"#555",textAlign:"center",padding:40,fontSize:13}}>Complete workouts to see volume data</div>;
  const minDate=Math.min(...allDates); const maxDate=Math.max(...allDates);
  const weeks=[]; let wStart=new Date(weekKey(minDate)+"T00:00:00"); const wEnd=new Date(weekKey(maxDate)+"T00:00:00");
  while(wStart<=wEnd){ weeks.push(new Date(wStart)); wStart=new Date(wStart); wStart.setDate(wStart.getDate()+7); }
  const weeksDesc=[...weeks].reverse(); // newest first

  function setsForMuscle(muscle,weekStart){
    const wE=new Date(weekStart); wE.setDate(wE.getDate()+7); let total=0;
    store.workouts.filter(w=>w.startTime>=weekStart.getTime()&&w.startTime<wE.getTime()).forEach(w=>{
      w.exercises.forEach(we=>{
        const ex=store.exercises.find(e=>e.id===we.exId); if(!ex) return;
        const s=we.sets.filter(x=>x.done!==false).length;
        if(ex.primary===muscle) total+=s;
        else if(ex.secondary.includes(muscle)){ const sw=store.secondaryWeights[ex.id]||{}; total+=s*(sw[muscle]!==undefined?sw[muscle]:0.5); }
      });
    });
    return total;
  }
  function getColor(s,t){ if(s===0) return "#1a1a1a"; if(s>=t.min&&s<=t.max) return "#00cc44"; if(Math.abs(s-t.min)<=3||Math.abs(s-t.max)<=3) return "#ffaa00"; return "#ff4444"; }
  const target=store.volumeTargets[selectedMuscle]||{min:10,max:20};

  function wkColLabel(w,i){
    if(i===0) return "This wk";
    if(i===1) return "Last wk";
    return w.toLocaleDateString("en-US",{month:"short",day:"numeric"});
  }

  const CW=62; const LW=86; // cell width, label width

  return (
    <div>
      <div style={{fontWeight:700,fontSize:16,marginBottom:12}}>Weekly Volume</div>

      <div style={{display:"flex",gap:8,marginBottom:12}}>
        {[["history","History"],["chart","Chart"]].map(([k,l])=>(
          <button key={k} onClick={()=>setView(k)} style={{flex:1,padding:"8px",borderRadius:10,border:"1px solid",background:view===k?"#00e5ff22":"transparent",borderColor:view===k?"#00e5ff":"#333",color:view===k?"#00e5ff":"#666",fontSize:13,cursor:"pointer"}}>{l}</button>
        ))}
      </div>

      {/* ── HISTORY TABLE ── */}
      {view==="history"&&(
        <>
          <div style={{background:"#1a1a1a",borderRadius:12,padding:"10px 14px",marginBottom:10,border:"1px solid #222",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><div style={{fontWeight:600,fontSize:15}}>{selectedMuscle}</div><div style={{fontSize:12,color:"#666"}}>Target: {target.min}–{target.max} sets/wk</div></div>
            <div style={{display:"flex",gap:8,fontSize:10,color:"#555"}}>
              <span style={{display:"flex",alignItems:"center",gap:3}}><span style={{width:8,height:8,background:"#00cc44",borderRadius:2,display:"inline-block"}}/>In range</span>
              <span style={{display:"flex",alignItems:"center",gap:3}}><span style={{width:8,height:8,background:"#ffaa00",borderRadius:2,display:"inline-block"}}/>Near</span>
              <span style={{display:"flex",alignItems:"center",gap:3}}><span style={{width:8,height:8,background:"#ff4444",borderRadius:2,display:"inline-block"}}/>Off</span>
            </div>
          </div>
          <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch",borderRadius:10,border:"1px solid #222"}}>
            <div style={{display:"grid",gridTemplateColumns:`${LW}px ${weeksDesc.map(()=>CW+"px").join(" ")}`,minWidth:LW+weeksDesc.length*CW}}>
              {/* header row */}
              <div style={{background:"#161616",padding:"7px 8px",fontSize:9,color:"#555",fontWeight:700,letterSpacing:0.5,display:"flex",alignItems:"center",position:"sticky",left:0,zIndex:3,borderBottom:"1px solid #222"}}>MUSCLE</div>
              {weeksDesc.map((w,i)=>(
                <div key={i} style={{background:"#161616",padding:"5px 3px",textAlign:"center",fontSize:9,color:i===0?"#00e5ff":"#555",lineHeight:1.4,fontWeight:i===0?700:400,borderBottom:"1px solid #222",borderLeft:"1px solid #1e1e1e"}}>
                  {wkColLabel(w,i)}
                </div>
              ))}
              {/* data rows */}
              {MUSCLE_GROUPS.map((muscle,ri)=>{
                const tgt=store.volumeTargets[muscle]||{min:10,max:20};
                const isSel=muscle===selectedMuscle;
                const rowBg=isSel?"#1e2a1e":ri%2===0?"#111":"#0f0f0f";
                return (
                  <React.Fragment key={muscle}>
                    <div onClick={()=>setSelectedMuscle(muscle)} style={{background:rowBg,padding:"0 8px",height:34,display:"flex",alignItems:"center",position:"sticky",left:0,zIndex:2,cursor:"pointer",borderBottom:"1px solid #1a1a1a",borderRight:"1px solid #1e1e1e"}}>
                      <span style={{fontSize:12,color:isSel?"#00e5ff":"#666",fontWeight:isSel?700:400}}>{muscle}</span>
                    </div>
                    {weeksDesc.map((w,i)=>{
                      const s=setsForMuscle(muscle,w);
                      const col=getColor(s,tgt);
                      const textCol=s===0?"#2a2a2a":col==="#1a1a1a"?"#444":"#000";
                      return (
                        <div key={i} style={{background:rowBg,height:34,display:"flex",alignItems:"center",justifyContent:"center",borderBottom:"1px solid #1a1a1a",borderLeft:"1px solid #1e1e1e"}}>
                          <div style={{background:col,borderRadius:5,width:CW-8,height:24,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700,color:textCol}}>
                            {s>0?fmtVol(s):""}
                          </div>
                        </div>
                      );
                    })}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
          <div style={{fontSize:10,color:"#444",textAlign:"center",marginTop:8}}>← scroll left to see older weeks</div>
        </>
      )}

      {/* ── CHART VIEW (original heatmap) ── */}
      {view==="chart"&&(
        <>
          <div style={{background:"#1a1a1a",borderRadius:12,padding:12,marginBottom:14,border:"1px solid #222",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><div style={{fontWeight:600,fontSize:15}}>{selectedMuscle}</div><div style={{fontSize:12,color:"#666"}}>Target: {target.min}–{target.max} sets/wk</div></div>
            <div style={{display:"flex",gap:8,fontSize:11}}><span style={{color:"#00cc44"}}>In range</span><span style={{color:"#ffaa00"}}>±3</span><span style={{color:"#ff4444"}}>Off</span></div>
          </div>
          <div style={{overflowX:"auto"}}>
            <div style={{minWidth:Math.max(300,weeks.length*72)+88}}>
              <div style={{display:"grid",gridTemplateColumns:`88px repeat(${weeks.length},1fr)`,gap:3,marginBottom:4}}>
                <div style={{fontSize:10,color:"#444"}}>Muscle</div>
                {weeks.map((w,i)=><div key={i} style={{fontSize:9,color:"#444",textAlign:"center",lineHeight:1.2}}>{w.toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div>)}
              </div>
              {MUSCLE_GROUPS.map(muscle=>{
                const isSel=muscle===selectedMuscle;
                return (
                  <div key={muscle} onClick={()=>setSelectedMuscle(muscle)} style={{display:"grid",gridTemplateColumns:`88px repeat(${weeks.length},1fr)`,gap:3,marginBottom:3,opacity:isSel?1:0.45,cursor:"pointer"}}>
                    <div style={{fontSize:12,color:isSel?"#fff":"#666",display:"flex",alignItems:"center",fontWeight:isSel?700:400}}>{muscle}</div>
                    {weeks.map((w,i)=>{ const s=setsForMuscle(muscle,w); const tgt=store.volumeTargets[muscle]||{min:10,max:20}; const col=getColor(s,tgt); return <div key={i} style={{background:col,borderRadius:5,height:30,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:600,color:s===0?"#444":col==="#1a1a1a"?"#444":"#000"}}>{s>0?fmtVol(s):""}</div>; })}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── SPLIT TAB ──────────────────────────────────────────────────────────────────
function SplitTab({store,save}){
  const [editing,setEditing]=useState(null);
  const splits=store.splits||[];

  function deleteSplit(id){
    save({...store,splits:splits.filter(s=>s.id!==id),activeSplitId:store.activeSplitId===id?null:store.activeSplitId});
  }
  function saveSplit(sp){
    const existing=splits.find(s=>s.id===sp.id);
    save({...store,splits:existing?splits.map(s=>s.id===sp.id?sp:s):[...splits,sp]});
    setEditing(null);
  }
  function setActive(id){
    const newActiveId=store.activeSplitId===id?null:id;
    // move newly active split to front of list
    const reordered=newActiveId
      ? [splits.find(s=>s.id===newActiveId),...splits.filter(s=>s.id!==newActiveId)]
      : splits;
    save({...store,splits:reordered,activeSplitId:newActiveId});
  }

  if(editing){
    const existing=splits.find(s=>s.id===editing);
    return <SplitEditor initial={existing||null} store={store} onSave={saveSplit} onCancel={()=>setEditing(null)}/>;
  }

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div style={{fontWeight:700,fontSize:16}}>Split Planning</div>
        <button onClick={()=>setEditing("new")} style={{background:"#00e5ff",color:"#000",border:"none",borderRadius:8,padding:"6px 14px",fontSize:13,fontWeight:600,cursor:"pointer"}}>+ New Split</button>
      </div>
      {splits.length===0&&(
        <div style={{color:"#555",textAlign:"center",padding:"40px 20px",fontSize:13}}>
          Plan your training split here. Create a split and set it as active to see planned workouts on the home screen and calendar.
        </div>
      )}
      {splits.map(sp=>(
        <SplitCard key={sp.id} split={sp} store={store} isActive={store.activeSplitId===sp.id}
          onEdit={()=>setEditing(sp.id)} onDelete={()=>deleteSplit(sp.id)} onSetActive={()=>setActive(sp.id)}/>
      ))}
    </div>
  );
}

function SplitCard({split,store,isActive,onEdit,onDelete,onSetActive}){
  const [expanded,setExpanded]=useState(false);
  const [confirmDel,setConfirmDel]=useState(false);
  const [expandedCell,setExpandedCell]=useState(null);
  const [justActivated,setJustActivated]=useState(false);
  const prevActive=useRef(isActive);
  useEffect(()=>{ if(isActive&&!prevActive.current){ setJustActivated(true); setTimeout(()=>setJustActivated(false),700); } prevActive.current=isActive; },[isActive]);

  const weeklyVolume={};
  split.days.filter(d=>!d.isRest).forEach(d=>{
    const mult=split.type==="interval"&&split.interval>0?7/split.interval:1;
    (d.muscles||[]).forEach(({muscle,sets})=>{ weeklyVolume[muscle]=(weeklyVolume[muscle]||0)+(parseFloat(sets)||0)*mult; });
  });

  return (
    <div style={{background:"#1a1a1a",borderRadius:12,marginBottom:12,border:`1px solid ${isActive?"#00e5ff44":"#222"}`,overflow:"hidden",animation:justActivated?"splitActivate 0.7s ease":"none"}}>
      <div style={{padding:"13px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{fontWeight:700,fontSize:15}}>{split.name}</div>
            {isActive&&<span style={{background:"#00e5ff22",border:"1px solid #00e5ff55",color:"#00e5ff",fontSize:10,borderRadius:10,padding:"1px 7px",fontWeight:700}}>ACTIVE</span>}
          </div>
          <div style={{fontSize:11,color:"#666",marginTop:2}}>{split.type==="weekly"?"Week-based":`Every ${split.interval} days`} · {split.days.filter(d=>!d.isRest).length} training days</div>
        </div>
        <div style={{display:"flex",gap:6,flexShrink:0}}>
          <button onClick={onSetActive} style={{background:isActive?"#00e5ff22":"#222",border:`1px solid ${isActive?"#00e5ff55":"#333"}`,color:isActive?"#00e5ff":"#888",borderRadius:8,padding:"5px 10px",cursor:"pointer",fontSize:11,fontWeight:isActive?700:400}}>
            {isActive?"Active":"Set Active"}
          </button>
          <button onClick={()=>setExpanded(!expanded)} style={{background:"#222",border:"none",color:"#888",borderRadius:8,width:30,height:30,cursor:"pointer",fontSize:12}}>{expanded?"▲":"▼"}</button>
          <button onClick={onEdit} style={{background:"#222",border:"none",color:"#888",borderRadius:8,width:30,height:30,cursor:"pointer",fontSize:13}}>✎</button>
        </div>
      </div>

      {expanded&&(
        <div style={{borderTop:"1px solid #1e1e1e",padding:14}}>
          {/* weekly grid */}
          {split.type==="weekly"&&(
            <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3,marginBottom:14}}>
              {DAYS_OF_WEEK.map((day,i)=>{
                const d=split.days.find(x=>x.dayIndex===i);
                const isRest=d?.isRest;
                return (
                  <div key={i} style={{background:d&&!isRest?"#00e5ff18":isRest?"#1e1e1e":"#111",borderRadius:8,padding:"5px 2px",textAlign:"center",border:d&&!isRest?"1px solid #00e5ff33":"1px solid #1a1a1a",minHeight:58}}>
                    <div style={{fontSize:9,color:d&&!isRest?"#00e5ff":isRest?"#444":"#444",fontWeight:700,marginBottom:3}}>{day.slice(0,3).toUpperCase()}</div>
                    {d&&!isRest?(()=>{const ms=d.muscles||[];const show=expandedCell===i?ms:ms.slice(0,2);const extra=ms.length-2;return(<>{show.map((m,mi)=>(<div key={mi} style={{fontSize:8,color:"#aaa",lineHeight:1.3}}>{m.muscle.slice(0,5)}<br/><span style={{color:"#00e5ff"}}>{m.sets}</span></div>))}{extra>0&&expandedCell!==i&&<div onClick={e=>{e.stopPropagation();setExpandedCell(i);}} style={{fontSize:8,color:"#00e5ff77",cursor:"pointer",marginTop:1}}>+{extra}</div>}</>);})():<div style={{fontSize:8,color:"#333",marginTop:6}}>{isRest?"Rest":"—"}</div>}
                  </div>
                );
              })}
            </div>
          )}
          {split.type==="interval"&&(
            <div style={{display:"flex",gap:4,overflowX:"auto",marginBottom:14,paddingBottom:4}}>
              {Array.from({length:split.interval||1},(_,i)=>{
                const d=split.days.find(x=>x.dayIndex===i);
                const isRest=d?.isRest;
                return (
                  <div key={i} style={{flexShrink:0,background:d&&!isRest?"#00e5ff18":"#111",borderRadius:8,padding:"6px 8px",textAlign:"center",border:d&&!isRest?"1px solid #00e5ff33":"1px solid #1a1a1a",minWidth:56}}>
                    <div style={{fontSize:9,color:d&&!isRest?"#00e5ff":"#444",fontWeight:700,marginBottom:3}}>Day {i+1}</div>
                    {d&&!isRest?(()=>{const ms=d.muscles||[];const show=expandedCell===i?ms:ms.slice(0,2);const extra=ms.length-2;return(<>{show.map((m,mi)=>(<div key={mi} style={{fontSize:9,color:"#aaa",lineHeight:1.3}}>{m.muscle.slice(0,5)} <span style={{color:"#00e5ff"}}>{m.sets}</span></div>))}{extra>0&&expandedCell!==i&&<div onClick={e=>{e.stopPropagation();setExpandedCell(i);}} style={{fontSize:8,color:"#00e5ff77",cursor:"pointer",marginTop:1}}>+{extra}</div>}</>);})():<div style={{fontSize:9,color:"#333",marginTop:5}}>{isRest?"Rest":"—"}</div>}
                  </div>
                );
              })}
            </div>
          )}

          {/* weekly volume */}
          {Object.keys(weeklyVolume).length>0&&(
            <>
              <div style={{fontWeight:600,fontSize:12,marginBottom:8,color:"#666"}}>Planned Weekly Volume</div>
              <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:14}}>
                {MUSCLE_GROUPS.filter(m=>weeklyVolume[m]>0).map(m=>{
                  const s=weeklyVolume[m]; const tgt=store.volumeTargets[m]||{min:10,max:20};
                  const col=s>=tgt.min&&s<=tgt.max?"#00cc44":Math.abs(s-tgt.min)<=3||Math.abs(s-tgt.max)<=3?"#ffaa00":"#ff4444";
                  return <div key={m} style={{background:"#111",borderRadius:8,padding:"4px 9px",border:`1px solid ${col}44`}}>
                    <div style={{fontSize:10,color:"#777"}}>{m}</div><div style={{fontSize:12,fontWeight:700,color:col}}>{fmtVol(s)}</div>
                  </div>;
                })}
              </div>
            </>
          )}

          {confirmDel
            ?<div style={{display:"flex",gap:8}}>
                <button onClick={onDelete} style={{flex:1,background:"#ff4444",border:"none",borderRadius:8,padding:"8px",color:"#fff",fontWeight:700,cursor:"pointer",fontSize:13}}>Confirm Delete</button>
                <button onClick={()=>setConfirmDel(false)} style={{flex:1,background:"#222",border:"none",borderRadius:8,padding:"8px",color:"#888",cursor:"pointer",fontSize:13}}>Cancel</button>
              </div>
            :<button onClick={()=>setConfirmDel(true)} style={{width:"100%",background:"none",border:"1px solid #ff444433",color:"#ff6666",borderRadius:8,padding:"7px",cursor:"pointer",fontSize:12}}>Delete Split</button>
          }
        </div>
      )}
    </div>
  );
}

function SplitEditor({initial,store,onSave,onCancel}){
  const [name,setName]=useState(initial?.name||"");
  const [type,setType]=useState(initial?.type||"weekly");
  const [intervalStr,setIntervalStr]=useState(String(initial?.interval||4));
  const [startDate,setStartDate]=useState(initial?.startDate||new Date().toISOString().slice(0,10));
  const [days,setDays]=useState(initial?.days||[]);
  const [editingDay,setEditingDay]=useState(null);
  const [showExSearch,setShowExSearch]=useState(false);
  const [exSearch,setExSearch]=useState("");

  const intervalNum=parseInt(intervalStr)||0;
  const totalSlots=type==="weekly"?7:Math.max(2,intervalNum);
  const slotLabels=type==="weekly"?DAYS_OF_WEEK:Array.from({length:totalSlots},(_,i)=>`Day ${i+1}`);

  const weeklyVolume={};
  days.filter(d=>!d.isRest).forEach(d=>{
    const mult=type==="interval"&&intervalNum>0?7/intervalNum:1;
    (d.muscles||[]).forEach(({muscle,sets})=>{ weeklyVolume[muscle]=(weeklyVolume[muscle]||0)+(parseFloat(sets)||0)*mult; });
  });

  function toggleDay(idx){
    const existing=days.find(d=>d.dayIndex===idx);
    if(existing){ setDays(days.filter(d=>d.dayIndex!==idx)); if(editingDay===idx) setEditingDay(null); }
    else{ setDays([...days,{dayIndex:idx,label:"",isRest:false,muscles:[],exercises:[]}]); setEditingDay(idx); }
  }
  function selectDay(idx){
    if(editingDay===idx){ toggleDay(idx); } // clicking active day deselects/removes it
    else{ setEditingDay(idx); }
  }
  function updateDayField(idx,field,val){ setDays(days.map(d=>d.dayIndex===idx?{...d,[field]:val}:d)); }
  function toggleRest(idx){ setDays(days.map(d=>d.dayIndex===idx?{...d,isRest:!d.isRest}:d)); }
  function addMuscle(dayIdx,muscle){ setDays(days.map(d=>d.dayIndex===dayIdx?{...d,muscles:[...(d.muscles||[]),{muscle,sets:"3"}]}:d)); }
  function removeMuscle(dayIdx,muscle){ setDays(days.map(d=>d.dayIndex===dayIdx?{...d,muscles:(d.muscles||[]).filter(m=>m.muscle!==muscle)}:d)); }
  function updateMuscleSets(dayIdx,muscle,val){ setDays(days.map(d=>d.dayIndex===dayIdx?{...d,muscles:(d.muscles||[]).map(m=>m.muscle===muscle?{...m,sets:val}:m)}:d)); }
  function addExToDay(dayIdx,exId){ setDays(days.map(d=>d.dayIndex===dayIdx?{...d,exercises:[...(d.exercises||[]),{exId,sets:[{reps:10,weight:0},{reps:10,weight:0},{reps:10,weight:0}]}]}:d)); setExSearch(""); setShowExSearch(false); }
  function removeExFromDay(dayIdx,exId){ setDays(days.map(d=>d.dayIndex===dayIdx?{...d,exercises:(d.exercises||[]).filter(e=>e.exId!==exId)}:d)); }
  function updateExSets(dayIdx,exId,count){ setDays(days.map(d=>{ if(d.dayIndex!==dayIdx) return d; const def={reps:10,weight:0}; const exercises=(d.exercises||[]).map(e=>{ if(e.exId!==exId) return e; const cur=e.sets||[]; const next=count>cur.length?[...cur,...Array.from({length:count-cur.length},()=>({...def}))]:cur.slice(0,count); return {...e,sets:next}; }); return {...d,exercises}; })); }

  function handleSave(){
    if(!name.trim()) return;
    const parsedInterval=parseInt(intervalStr)||4;
    const sp={id:initial?.id||("sp"+Date.now()),name:name.trim(),type,interval:type==="interval"?parsedInterval:undefined,startDate:type==="interval"?startDate:undefined,days};
    onSave(sp);
  }

  const editDay=days.find(d=>d.dayIndex===editingDay);
  const filteredEx=store.exercises.filter(e=>e.name.toLowerCase().includes(exSearch.toLowerCase()));

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div style={{fontWeight:700,fontSize:16}}>{initial?"Edit Split":"New Split"}</div>
        <button onClick={onCancel} style={{background:"#222",border:"none",color:"#888",borderRadius:8,padding:"6px 12px",cursor:"pointer",fontSize:13}}>Cancel</button>
      </div>

      <div style={{background:"#1a1a1a",borderRadius:12,padding:14,marginBottom:12,border:"1px solid #222"}}>
        <label style={{fontSize:12,color:"#666",display:"block",marginBottom:5}}>Split Name</label>
        <input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. PPL, Upper/Lower..." style={{...inputStyle,marginBottom:12}}/>
        <label style={{fontSize:12,color:"#666",display:"block",marginBottom:8}}>Type</label>
        <div style={{display:"flex",gap:8,marginBottom:type==="interval"?12:0}}>
          {[["weekly","Week-based"],["interval","Interval-based"]].map(([k,l])=>(
            <button key={k} onClick={()=>setType(k)} style={{flex:1,padding:"8px",borderRadius:8,border:"1px solid",fontSize:13,cursor:"pointer",background:type===k?"#00e5ff22":"transparent",borderColor:type===k?"#00e5ff":"#333",color:type===k?"#00e5ff":"#666"}}>{l}</button>
          ))}
        </div>
        {type==="interval"&&(
          <>
            <label style={{fontSize:12,color:"#666",display:"block",marginBottom:5,marginTop:12}}>Interval (days)</label>
            <input type="number" inputMode="numeric" min={2} max={14} value={intervalStr} placeholder="e.g. 4"
              onChange={e=>setIntervalStr(e.target.value)}
              onBlur={e=>{ const n=parseInt(e.target.value); if(!n||n<2) setIntervalStr("4"); else if(n>14) setIntervalStr("14"); }}
              style={{...inputStyle,marginBottom:12}}/>
            <label style={{fontSize:12,color:"#666",display:"block",marginBottom:5}}>Cycle Start Date</label>
            <input type="date" value={startDate} onChange={e=>setStartDate(e.target.value)} style={{...inputStyle,colorScheme:"dark"}}/>
          </>
        )}
      </div>

      {/* day slots */}
      <div style={{background:"#1a1a1a",borderRadius:12,padding:14,marginBottom:12,border:"1px solid #222"}}>
        <div style={{fontWeight:600,fontSize:14,marginBottom:10}}>Training Days <span style={{fontSize:12,color:"#555",fontWeight:400}}>— tap to toggle, tap again to edit</span></div>
        {type==="weekly"&&(
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:3,marginBottom:editDay?12:0}}>
            {slotLabels.map((label,i)=>{
              const d=days.find(x=>x.dayIndex===i);
              const isRest=d?.isRest;
              return (
                <button key={i} onClick={()=>d?selectDay(i):toggleDay(i)} style={{
                  aspectRatio:"1",borderRadius:8,border:"1px solid",fontSize:8,cursor:"pointer",fontWeight:700,padding:1,
                  background:editingDay===i?"#00e5ff33":d&&!isRest?"#00e5ff18":isRest?"#1a1a1a":"transparent",
                  borderColor:editingDay===i?"#00e5ff":d&&!isRest?"#00e5ff55":isRest?"#333":"#2a2a2a",
                  color:d&&!isRest?"#00e5ff":isRest?"#555":"#444"
                }}>
                  <div>{label.slice(0,3).toUpperCase()}</div>
                  {d&&<div style={{fontSize:7,marginTop:1}}>{isRest?"REST":"TRAIN"}</div>}
                </button>
              );
            })}
          </div>
        )}
        {type==="interval"&&(
          <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:editDay?12:0}}>
            {slotLabels.map((label,i)=>{
              const d=days.find(x=>x.dayIndex===i); const isRest=d?.isRest;
              return (
                <button key={i} onClick={()=>d?selectDay(i):toggleDay(i)} style={{padding:"6px 10px",borderRadius:8,border:"1px solid",fontSize:12,cursor:"pointer",background:editingDay===i?"#00e5ff33":d&&!isRest?"#00e5ff18":"transparent",borderColor:editingDay===i?"#00e5ff":d&&!isRest?"#00e5ff55":"#333",color:d&&!isRest?"#00e5ff":isRest?"#555":"#555"}}>{label}{d&&isRest?" (Rest)":""}</button>
              );
            })}
          </div>
        )}

        {/* day editor */}
        {editDay&&(
          <div style={{background:"#111",borderRadius:10,padding:12,border:"1px solid #2a2a2a"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div style={{fontWeight:600,fontSize:13,color:"#00e5ff"}}>{slotLabels[editingDay]}</div>
              <div style={{display:"flex",gap:6}}>
                <button onClick={()=>toggleRest(editingDay)} style={{background:editDay.isRest?"#ff444422":"#222",border:`1px solid ${editDay.isRest?"#ff444455":"#333"}`,color:editDay.isRest?"#ff6666":"#888",borderRadius:6,padding:"4px 10px",cursor:"pointer",fontSize:11}}>{editDay.isRest?"Rest Day ✓":"Mark as Rest"}</button>
                <button onClick={()=>{ setDays(days.filter(d=>d.dayIndex!==editingDay)); setEditingDay(null); }} style={{background:"none",border:"none",color:"#444",fontSize:16,cursor:"pointer"}}>×</button>
              </div>
            </div>

            {!editDay.isRest&&(
              <>
                <input value={editDay.label||""} onChange={e=>updateDayField(editingDay,"label",e.target.value)} placeholder="Session name (e.g. Push, Pull...)" style={{...inputStyle,marginBottom:10,fontSize:13}}/>

                <div style={{fontSize:12,color:"#666",marginBottom:6}}>Muscle groups & planned sets</div>
                {(()=>{ const exVol={}; (editDay.exercises||[]).forEach(e=>{ const ex=store.exercises.find(x=>x.id===e.exId); if(ex) exVol[ex.primary]=(exVol[ex.primary]||0)+(e.sets||[]).length; }); return (editDay.muscles||[]).map(({muscle,sets})=>{ const actual=exVol[muscle]||0; const target=parseFloat(sets)||0; const green=target>0&&actual>=target-1; return (
                  <div key={muscle} style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                    <span style={{flex:1,fontSize:13,color:"#ccc"}}>{muscle}</span>
                    {actual>0&&<span style={{fontSize:11,color:green?"#00cc44":"#ffaa00",fontWeight:green?700:400}}>{actual}/{target}</span>}
                    <input type="number" inputMode="numeric" value={sets} placeholder="0"
                      onChange={e=>updateMuscleSets(editingDay,muscle,e.target.value)}
                      onBlur={e=>{ if(e.target.value===""||isNaN(parseFloat(e.target.value))) updateMuscleSets(editingDay,muscle,"0"); }}
                      style={{width:52,background:"#1a1a1a",border:`1px solid ${green?"#00cc4455":"#333"}`,borderRadius:6,padding:"5px 6px",color:"#fff",fontSize:13,textAlign:"center"}}/>
                    <span style={{fontSize:11,color:"#555"}}>sets</span>
                    <button onClick={()=>removeMuscle(editingDay,muscle)} style={{background:"none",border:"none",color:"#ff4444",fontSize:16,cursor:"pointer",padding:"0 2px"}}>×</button>
                  </div>
                ); }); })()}
                <div style={{display:"flex",flexWrap:"wrap",gap:4,marginTop:6}}>
                  {MUSCLE_GROUPS.filter(m=>!(editDay.muscles||[]).find(x=>x.muscle===m)).map(m=>(
                    <button key={m} onClick={()=>addMuscle(editingDay,m)} style={{padding:"3px 9px",borderRadius:14,border:"1px solid #333",background:"transparent",color:"#666",fontSize:11,cursor:"pointer"}}>+ {m}</button>
                  ))}
                </div>

                {/* optional exercises */}
                <div style={{borderTop:"1px solid #222",marginTop:12,paddingTop:10}}>
                  <div style={{fontSize:12,color:"#666",marginBottom:7}}>Planned exercises <span style={{color:"#444"}}>(optional — will pre-load when starting this session)</span></div>
                  {(editDay.exercises||[]).map(e=>{
                    const ex=store.exercises.find(x=>x.id===e.exId);
                    return ex?(
                      <div key={e.exId} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:"1px solid #1a1a1a"}}>
                        <div><div style={{fontSize:13}}>{ex.name}</div><div style={{fontSize:11,color:"#555"}}>{ex.equipment} · {ex.primary}</div></div>
                        <div style={{display:"flex",alignItems:"center",gap:5}}>
                          <button onClick={()=>updateExSets(editingDay,e.exId,Math.max(1,(e.sets||[]).length-1))} style={{background:"#222",border:"none",color:"#888",borderRadius:5,width:26,height:26,cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>−</button>
                          <span style={{fontSize:13,color:"#fff",minWidth:18,textAlign:"center"}}>{(e.sets||[]).length}</span>
                          <button onClick={()=>updateExSets(editingDay,e.exId,(e.sets||[]).length+1)} style={{background:"#222",border:"none",color:"#888",borderRadius:5,width:26,height:26,cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
                          <button onClick={()=>removeExFromDay(editingDay,e.exId)} style={{background:"none",border:"none",color:"#ff4444",fontSize:16,cursor:"pointer",marginLeft:4}}>×</button>
                        </div>
                      </div>
                    ):null;
                  })}
                  <button onClick={()=>setShowExSearch(!showExSearch)} style={{background:"#1a1a1a",border:"1px dashed #333",borderRadius:8,color:"#666",padding:"6px 12px",fontSize:12,cursor:"pointer",marginTop:8,width:"100%"}}>+ Add exercise</button>
                  {showExSearch&&(
                    <div style={{marginTop:8}}>
                      <input value={exSearch} onChange={e=>setExSearch(e.target.value)} placeholder="Search..." style={{...inputStyle,marginBottom:6,fontSize:13}}/>
                      <div style={{maxHeight:140,overflowY:"auto"}}>
                        {filteredEx.filter(e=>!(editDay.exercises||[]).find(x=>x.exId===e.id)).map(e=>(
                          <div key={e.id} onClick={()=>addExToDay(editingDay,e.id)} style={{padding:"7px 8px",borderRadius:6,cursor:"pointer",fontSize:13,background:"transparent"}}
                            onMouseEnter={ev=>ev.currentTarget.style.background="#222"} onMouseLeave={ev=>ev.currentTarget.style.background="transparent"}>
                            <span style={{color:"#fff"}}>{e.name}</span> <span style={{color:"#555",fontSize:11}}>{e.equipment} · {e.primary}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
            <button onClick={()=>setEditingDay(null)} style={{width:"100%",background:"#1a1a1a",border:"none",borderRadius:8,padding:"7px",color:"#888",cursor:"pointer",fontSize:12,marginTop:10}}>Done</button>
          </div>
        )}
      </div>

      {/* weekly volume preview */}
      {days.filter(d=>!d.isRest).length>0&&Object.keys(weeklyVolume).length>0&&(
        <div style={{background:"#1a1a1a",borderRadius:12,padding:14,marginBottom:12,border:"1px solid #222"}}>
          <div style={{fontWeight:600,fontSize:14,marginBottom:10}}>Projected Weekly Volume</div>
          {MUSCLE_GROUPS.filter(m=>weeklyVolume[m]>0).map(m=>{
            const s=weeklyVolume[m]; const tgt=store.volumeTargets[m]||{min:10,max:20};
            const pct=Math.min(100,(s/(tgt.max||1))*100);
            const col=s>=tgt.min&&s<=tgt.max?"#00cc44":s<tgt.min?"#ffaa00":"#ff4444";
            return (
              <div key={m} style={{marginBottom:8}}>
                <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:3}}>
                  <span style={{color:"#ccc"}}>{m}</span><span style={{color:col,fontWeight:600}}>{fmtVol(s)} / {tgt.min}–{tgt.max}</span>
                </div>
                <div style={{height:5,background:"#222",borderRadius:3}}><div style={{height:5,background:col,borderRadius:3,width:`${pct}%`,transition:"width 0.3s"}}/></div>
              </div>
            );
          })}
        </div>
      )}

      <button onClick={handleSave} disabled={!name.trim()} style={{width:"100%",background:name.trim()?"#00e5ff":"#333",border:"none",borderRadius:12,padding:14,color:name.trim()?"#000":"#666",fontWeight:700,fontSize:15,cursor:name.trim()?"pointer":"default"}}>
        {initial?"Save Changes":"Create Split"}
      </button>
    </div>
  );
}

// ── SETTINGS TAB ───────────────────────────────────────────────────────────────
function SettingsTab({store,save}){
  const [section,setSection]=useState(null);
  const rows=[
    {key:"gyms",label:"Gyms",sub:`${store.gyms.length} gym${store.gyms.length!==1?"s":""} · Default: ${store.defaultGym||store.gyms[0]}`},
    {key:"volume",label:"Volume Targets",sub:"Weekly set targets per muscle"},
    {key:"exercises",label:"Exercises",sub:"Manage exercises and secondary muscle contribution"},
    {key:"resttimer",label:"Rest Timer",sub:`Default: ${Math.floor((store.defaultRestTime||150)/60)}:${String((store.defaultRestTime||150)%60).padStart(2,"0")}`},
  ];
  if(section==="gyms") return <SettingsDetail title="Gyms" onBack={()=>setSection(null)}><GymsSettings store={store} save={save}/></SettingsDetail>;
  if(section==="volume") return <SettingsDetail title="Volume Targets" onBack={()=>setSection(null)}><VolumeTargetsSettings store={store} save={save}/></SettingsDetail>;
  if(section==="exercises") return <SettingsDetail title="Exercises" onBack={()=>setSection(null)}><ExercisesSettings store={store} save={save}/></SettingsDetail>;
  if(section==="resttimer") return <SettingsDetail title="Rest Timer" onBack={()=>setSection(null)}><RestTimerSettings store={store} save={save}/></SettingsDetail>;
  return (
    <div>
      <div style={{fontWeight:700,fontSize:16,marginBottom:16}}>Settings</div>
      <div style={{background:"#1a1a1a",borderRadius:12,border:"1px solid #222",overflow:"hidden"}}>
        {rows.map((r,i)=>(
          <button key={r.key} onClick={()=>setSection(r.key)} style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 16px",background:"none",border:"none",cursor:"pointer",textAlign:"left",borderBottom:i<rows.length-1?"1px solid #222":"none"}}>
            <div><div style={{fontWeight:500,fontSize:14,color:"#fff"}}>{r.label}</div>{r.sub&&<div style={{fontSize:12,color:"#555",marginTop:2}}>{r.sub}</div>}</div>
            <span style={{color:"#444",fontSize:16}}>›</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function SettingsDetail({title,onBack,children}){
  return (
    <div>
      <button onClick={onBack} style={{background:"none",border:"none",color:"#00e5ff",fontSize:14,cursor:"pointer",padding:"0 0 14px 0",display:"flex",alignItems:"center",gap:4}}>‹ {title}</button>
      {children}
    </div>
  );
}

function GymsSettings({store,save}){
  const [newGym,setNewGym]=useState(""); const [renaming,setRenaming]=useState(null); const [renameVal,setRenameVal]=useState("");
  const defaultGym=store.defaultGym||store.gyms[0];
  function addGym(){ if(!newGym.trim()) return; save({...store,gyms:[...store.gyms,newGym.trim()]}); setNewGym(""); }
  function removeGym(g){ if(store.gyms.length<=1) return; save({...store,gyms:store.gyms.filter(x=>x!==g),defaultGym:store.defaultGym===g?store.gyms.find(x=>x!==g):store.defaultGym}); }
  function setDefault(g){ save({...store,defaultGym:g}); }
  function startRename(g){ setRenaming(g); setRenameVal(g); }
  function confirmRename(){
    if(!renameVal.trim()||renameVal.trim()===renaming){ setRenaming(null); return; }
    const n=renameVal.trim();
    save({...store,gyms:store.gyms.map(g=>g===renaming?n:g),templates:store.templates.map(t=>({...t,gym:t.gym===renaming?n:t.gym})),workouts:store.workouts.map(w=>({...w,gym:w.gym===renaming?n:w.gym})),defaultGym:store.defaultGym===renaming?n:store.defaultGym});
    setRenaming(null);
  }
  return (
    <div>
      <div style={{color:"#666",fontSize:13,marginBottom:14}}>Tap ★ to set a gym as your main gym.</div>
      <div style={{display:"flex",gap:8,marginBottom:14}}>
        <input value={newGym} onChange={e=>setNewGym(e.target.value)} placeholder="New gym name..." style={{...inputStyle}} onKeyDown={e=>e.key==="Enter"&&addGym()}/>
        <button onClick={addGym} style={{background:"#00e5ff",border:"none",borderRadius:8,padding:"8px 14px",color:"#000",fontWeight:700,cursor:"pointer",flexShrink:0}}>Add</button>
      </div>
      <div style={{background:"#1a1a1a",borderRadius:12,border:"1px solid #222",overflow:"hidden"}}>
        {store.gyms.map((g,i)=>(
          <div key={g} style={{borderBottom:i<store.gyms.length-1?"1px solid #222":"none"}}>
            {renaming===g
              ?<div style={{display:"flex",gap:8,padding:"10px 14px",alignItems:"center"}}>
                  <input value={renameVal} onChange={e=>setRenameVal(e.target.value)} onKeyDown={e=>e.key==="Enter"&&confirmRename()} style={{...inputStyle,flex:1,fontSize:14,padding:"6px 10px"}} autoFocus/>
                  <button onClick={confirmRename} style={{background:"#00e5ff",border:"none",borderRadius:6,padding:"6px 10px",color:"#000",fontWeight:700,cursor:"pointer",fontSize:13}}>Save</button>
                  <button onClick={()=>setRenaming(null)} style={{background:"#222",border:"none",borderRadius:6,padding:"6px 10px",color:"#888",cursor:"pointer",fontSize:13}}>Cancel</button>
                </div>
              :<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"13px 16px"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <button onClick={()=>setDefault(g)} style={{background:"none",border:"none",fontSize:18,cursor:"pointer",padding:"0 2px",color:defaultGym===g?"#ffcc00":"#333",lineHeight:1}} title="Set as main gym">{defaultGym===g?"★":"☆"}</button>
                    <span style={{fontSize:14,color:"#fff"}}>{g}</span>
                    {defaultGym===g&&<span style={{fontSize:10,color:"#ffcc00",background:"#ffcc0022",borderRadius:4,padding:"1px 6px"}}>Main</span>}
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={()=>startRename(g)} style={{background:"none",border:"1px solid #2a2a2a",color:"#888",borderRadius:6,padding:"4px 9px",fontSize:16,cursor:"pointer",lineHeight:1}}>✎</button>
                    {store.gyms.length>1&&<button onClick={()=>removeGym(g)} style={{background:"none",border:"none",color:"#ff4444",fontSize:18,cursor:"pointer",padding:"0 2px"}}>×</button>}
                  </div>
                </div>
            }
          </div>
        ))}
      </div>
    </div>
  );
}

function VolumeTargetsSettings({store,save}){
  return (
    <div>
      <div style={{color:"#666",fontSize:13,marginBottom:14}}>Target weekly sets per muscle group. Green = in range, yellow = within 3, red = outside.</div>
      <div style={{background:"#1a1a1a",borderRadius:12,border:"1px solid #222",overflow:"hidden"}}>
        {MUSCLE_GROUPS.map((m,i)=>{
          const t=store.volumeTargets[m]||{min:10,max:20};
          return (
            <div key={m} style={{padding:"11px 14px",borderBottom:i<MUSCLE_GROUPS.length-1?"1px solid #222":"none",display:"flex",alignItems:"center",justifyContent:"space-between",gap:10}}>
              <div style={{fontWeight:500,fontSize:14,minWidth:90}}>{m}</div>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontSize:12,color:"#555"}}>Min</span>
                <NumInput value={t.min} onChange={v=>save({...store,volumeTargets:{...store.volumeTargets,[m]:{...t,min:Math.max(0,Math.round(v))}}})} min={0} max={100}
                  style={{width:48,background:"#111",border:"1px solid #2a2a2a",borderRadius:6,padding:"5px 4px",color:"#fff",fontSize:13,textAlign:"center"}}/>
                <span style={{fontSize:12,color:"#555"}}>Max</span>
                <NumInput value={t.max} onChange={v=>save({...store,volumeTargets:{...store.volumeTargets,[m]:{...t,max:Math.max(0,Math.round(v))}}})} min={0} max={100}
                  style={{width:48,background:"#111",border:"1px solid #2a2a2a",borderRadius:6,padding:"5px 4px",color:"#fff",fontSize:13,textAlign:"center"}}/>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ExercisesSettings({store,save}){
  const [showNew,setShowNew]=useState(false);
  const [form,setForm]=useState({name:"",primary:"Chest",secondary:[],equipment:"Barbell"});
  const [expandedEx,setExpandedEx]=useState(null);
  const [filterMuscle,setFilterMuscle]=useState(null);

  function addExercise(){
    if(!form.name.trim()) return;
    const ex={id:"e"+Date.now(),...form,secondary:[...form.secondary]};
    const sw={...store.secondaryWeights}; if(!sw[ex.id]) sw[ex.id]={};
    ex.secondary.forEach(m=>{ if(sw[ex.id][m]===undefined) sw[ex.id][m]=0.5; });
    save({...store,exercises:[...store.exercises,ex],secondaryWeights:sw});
    setForm({name:"",primary:"Chest",secondary:[],equipment:"Barbell"}); setShowNew(false);
  }
  function toggleSecondary(m){ setForm(f=>({...f,secondary:f.secondary.includes(m)?f.secondary.filter(x=>x!==m):[...f.secondary,m]})); }
  function setSecWeight(exId,muscle,val){ save({...store,secondaryWeights:{...store.secondaryWeights,[exId]:{...(store.secondaryWeights[exId]||{}),[muscle]:val}}}); }
  function removeExercise(exId){ save({...store,exercises:store.exercises.filter(e=>e.id!==exId)}); if(expandedEx===exId) setExpandedEx(null); }
  function addSecToExercise(exId,muscle){
    const ex=store.exercises.find(e=>e.id===exId); if(!ex||ex.secondary.includes(muscle)) return;
    const updated=store.exercises.map(e=>e.id===exId?{...e,secondary:[...e.secondary,muscle]}:e);
    const sw={...store.secondaryWeights,[exId]:{...(store.secondaryWeights[exId]||{}),[muscle]:0.5}};
    save({...store,exercises:updated,secondaryWeights:sw});
  }
  function removeSecFromExercise(exId,muscle){
    const updated=store.exercises.map(e=>e.id===exId?{...e,secondary:e.secondary.filter(m=>m!==muscle)}:e);
    save({...store,exercises:updated});
  }

  const visibleExercises=filterMuscle
    ? store.exercises.filter(e=>e.primary===filterMuscle)
    : store.exercises;

  return (
    <div>
      <button onClick={()=>setShowNew(!showNew)} style={{width:"100%",background:"#1a1a1a",border:"1px dashed #333",borderRadius:10,color:"#888",padding:"12px",fontSize:14,cursor:"pointer",marginBottom:12}}>+ Add Custom Exercise</button>
      {showNew&&(
        <div style={{background:"#1a1a1a",borderRadius:12,padding:14,marginBottom:14,border:"1px solid #333"}}>
          <input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Exercise name" style={{...inputStyle,marginBottom:10}}/>
          <div style={{fontSize:12,color:"#666",marginBottom:5}}>Primary Muscle</div>
          <select value={form.primary} onChange={e=>setForm({...form,primary:e.target.value})} style={{...inputStyle,marginBottom:10,appearance:"none"}}>{MUSCLE_GROUPS.map(m=><option key={m}>{m}</option>)}</select>
          <div style={{fontSize:12,color:"#666",marginBottom:5}}>Equipment</div>
          <select value={form.equipment} onChange={e=>setForm({...form,equipment:e.target.value})} style={{...inputStyle,marginBottom:10,appearance:"none"}}>{EQUIPMENT_TYPES.map(t=><option key={t}>{t}</option>)}</select>
          <div style={{fontSize:12,color:"#666",marginBottom:6}}>Secondary Muscles</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12}}>
            {MUSCLE_GROUPS.filter(m=>m!==form.primary).map(m=>(
              <button key={m} onClick={()=>toggleSecondary(m)} style={{padding:"4px 10px",borderRadius:14,border:"1px solid",fontSize:12,cursor:"pointer",background:form.secondary.includes(m)?"#00e5ff22":"transparent",borderColor:form.secondary.includes(m)?"#00e5ff":"#333",color:form.secondary.includes(m)?"#00e5ff":"#666"}}>{m}</button>
            ))}
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={addExercise} style={{flex:1,background:"#00e5ff",border:"none",borderRadius:8,padding:"8px",color:"#000",fontWeight:700,cursor:"pointer"}}>Add</button>
            <button onClick={()=>setShowNew(false)} style={{flex:1,background:"#222",border:"none",borderRadius:8,padding:"8px",color:"#888",cursor:"pointer"}}>Cancel</button>
          </div>
        </div>
      )}

      {/* muscle group filter */}
      <div style={{marginBottom:10,overflowX:"auto",whiteSpace:"nowrap",paddingBottom:4}}>
        <button onClick={()=>setFilterMuscle(null)} style={{display:"inline-block",padding:"4px 11px",borderRadius:14,border:"1px solid",fontSize:12,cursor:"pointer",marginRight:5,background:!filterMuscle?"#00e5ff22":"transparent",borderColor:!filterMuscle?"#00e5ff":"#333",color:!filterMuscle?"#00e5ff":"#666"}}>All</button>
        {MUSCLE_GROUPS.map(m=>(
          <button key={m} onClick={()=>setFilterMuscle(filterMuscle===m?null:m)} style={{display:"inline-block",padding:"4px 11px",borderRadius:14,border:"1px solid",fontSize:12,cursor:"pointer",marginRight:5,background:filterMuscle===m?"#00e5ff22":"transparent",borderColor:filterMuscle===m?"#00e5ff":"#333",color:filterMuscle===m?"#00e5ff":"#666"}}>{m}</button>
        ))}
      </div>

      <div style={{background:"#1a1a1a",borderRadius:12,border:"1px solid #222",overflow:"hidden"}}>
        {visibleExercises.length===0&&<div style={{padding:"20px",textAlign:"center",color:"#555",fontSize:13}}>No exercises for {filterMuscle}</div>}
        {visibleExercises.map((ex,i)=>{
          const isExp=expandedEx===ex.id; const sw=store.secondaryWeights[ex.id]||{};
          return (
            <div key={ex.id} style={{borderBottom:i<visibleExercises.length-1?"1px solid #222":"none"}}>
              <div onClick={()=>setExpandedEx(isExp?null:ex.id)} style={{padding:"11px 14px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:"pointer"}}>
                <div>
                  <div style={{fontSize:13,fontWeight:500,color:"#fff"}}>{ex.name}</div>
                  <div style={{fontSize:11,marginTop:2}}>
                    <span style={{color:"#888"}}>{ex.equipment}</span>
                    <span style={{color:"#666"}}> · </span>
                    <span style={{color:"#00e5ff"}}>{ex.primary}</span>
                    {ex.secondary.length>0&&<><span style={{color:"#666"}}> · </span><span style={{color:"#ff9900"}}>{ex.secondary.join(", ")}</span></>}
                  </div>
                </div>
                <span style={{color:"#444",fontSize:12}}>{isExp?"▲":"▼"}</span>
              </div>
              {isExp&&(
                <div style={{background:"#111",padding:"10px 14px",borderTop:"1px solid #1a1a1a"}}>
                  <div style={{fontSize:12,color:"#666",marginBottom:8}}>Secondary muscles</div>
                  {ex.secondary.map(m=>{
                    const w=sw[m]!==undefined?sw[m]:0.5;
                    return (
                      <div key={m} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:7}}>
                        <div style={{display:"flex",alignItems:"center",gap:8}}>
                          <button onClick={()=>removeSecFromExercise(ex.id,m)} style={{background:"none",border:"none",color:"#ff4444",fontSize:16,cursor:"pointer",padding:"0 2px",lineHeight:1}}>×</button>
                          <span style={{fontSize:13,color:"#ff9900"}}>{m}</span>
                        </div>
                        <div style={{display:"flex",gap:4}}>
                          {[0,0.5,1].map(v=>(
                            <button key={v} onClick={()=>setSecWeight(ex.id,m,v)} style={{padding:"3px 10px",borderRadius:6,border:"1px solid",fontSize:12,cursor:"pointer",background:w===v?"#00e5ff22":"transparent",borderColor:w===v?"#00e5ff":"#333",color:w===v?"#00e5ff":"#666"}}>{v}</button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  <div style={{marginTop:8,marginBottom:8}}>
                    <div style={{fontSize:11,color:"#555",marginBottom:6}}>Add secondary muscle</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                      {MUSCLE_GROUPS.filter(m=>m!==ex.primary&&!ex.secondary.includes(m)).map(m=>(
                        <button key={m} onClick={()=>addSecToExercise(ex.id,m)} style={{padding:"3px 9px",borderRadius:12,border:"1px solid #333",background:"transparent",color:"#666",fontSize:11,cursor:"pointer"}}>+ {m}</button>
                      ))}
                    </div>
                  </div>
                  <button onClick={()=>removeExercise(ex.id)} style={{background:"none",border:"1px solid #ff444433",color:"#ff6666",borderRadius:6,padding:"5px 12px",fontSize:12,cursor:"pointer",marginTop:4}}>Remove Exercise</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RestTimerSettings({store,save}){
  const cur=store.defaultRestTime||150;
  const options=[[60,"1:00"],[90,"1:30"],[120,"2:00"],[150,"2:30"],[180,"3:00"],[240,"4:00"],[300,"5:00"]];
  return (
    <div>
      <div style={{color:"#666",fontSize:13,marginBottom:16}}>The timer starts automatically after each set is ticked. You can adjust it mid-rest by ±10s.</div>
      <div style={{background:"#1a1a1a",borderRadius:12,border:"1px solid #222",overflow:"hidden"}}>
        {options.map(([secs,label],i)=>(
          <button key={secs} onClick={()=>save({...store,defaultRestTime:secs})} style={{width:"100%",display:"flex",justifyContent:"space-between",alignItems:"center",padding:"13px 16px",background:"none",border:"none",cursor:"pointer",borderBottom:i<options.length-1?"1px solid #222":"none"}}>
            <span style={{fontSize:14,color:"#fff"}}>{label}</span>
            {cur===secs&&<span style={{color:"#00e5ff",fontSize:16}}>✓</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── MODAL ──────────────────────────────────────────────────────────────────────
function Modal({onClose,children}){
  return (
    <div style={{position:"fixed",inset:0,background:"#000000cc",zIndex:300,display:"flex",alignItems:"flex-end",justifyContent:"center"}} onClick={onClose}>
      <div style={{background:"#1a1a1a",borderRadius:"16px 16px 0 0",width:"100%",maxWidth:430,maxHeight:"85vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
