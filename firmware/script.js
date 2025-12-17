/* RemindiClock Web UI */
(function(){
  // Inject minimal style for active wifi button if not defined
  if(!document.getElementById('wc-inline-style')){
  const st=document.createElement('style'); st.id='wc-inline-style'; st.textContent=`button.active{outline:2px solid #1976d2; background:#1976d210}
    .wifi-item{display:flex;align-items:center;justify-content:space-between;gap:.5rem;min-width:180px}
    .wifi-name{flex:1;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .wifi-icon{position:relative;width:34px;height:14px;display:inline-block}
    .wifi-icon span{position:absolute;bottom:0;width:6px;background:#666;border-radius:1px;transition:.25s}
    .wifi-icon .b1{left:0;height:25%}
    .wifi-icon .b2{left:8px;height:25%}
    .wifi-icon .b3{left:16px;height:25%}
    .wifi-icon .b4{left:24px;height:25%}
    .wifi-icon.lvl2 .b1,.wifi-icon.lvl2 .b2{background:#4caf50;height:55%}
    .wifi-icon.lvl3 .b1,.wifi-icon.lvl3 .b2,.wifi-icon.lvl3 .b3{background:#4caf50;height:75%}
    .wifi-icon.lvl4 .b1,.wifi-icon.lvl4 .b2,.wifi-icon.lvl4 .b3,.wifi-icon.lvl4 .b4{background:#4caf50;height:100%}
    .wifi-icon.lvl1 .b1{background:#ff9800;height:40%}
    .wifi-icon.lvl1 .b2,.wifi-icon.lvl1 .b3,.wifi-icon.lvl1 .b4{opacity:.25}
    /* Minimal Modal Fallback Styles (for cases where style.css isn't loaded) */
    .modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.4);display:flex;align-items:flex-start;justify-content:center;padding:4vh 1rem;z-index:1200}
    .modal{background:#fff;color:#111;border:1px solid #e5e7eb;border-radius:12px;padding:1rem;max-width:520px;width:100%;box-shadow:0 20px 48px -12px rgba(0,0,0,.3)}
    .modal h2{margin:.2rem 0 1rem;font-size:1.1rem;color:#111}
    .actions-compact{display:flex;flex-direction:column;gap:.6rem}
    @media (min-width:480px){ .actions-compact{flex-direction:row;flex-wrap:wrap;align-items:center} }
    .inline-pause.mobile-stack{display:flex;flex-direction:column;gap:.4rem;width:100%}
    .inline-pause .pause-status{font-size:.75rem;color:#334155}
    .inline-pause .pause-row{display:flex;flex-wrap:wrap;gap:.4rem}
    .pause-select{min-width:86px}
    .inline-pause button{flex:1}
    @media (max-width:420px){ .inline-pause .pause-row{flex-direction:column} .inline-pause button{width:100%} }
    `; document.head.appendChild(st);
  }
  const app = document.getElementById('app');
  const State = {
    info:null,
    config:null,
    networks:[],
    scanning:false,
    step:0,              // Wizard step: 0 WiFi, 1 AdminPass, 2 Address, 3 Events, 4 Done
    wizardMode:true,
    toasts:[],
    connected:false,
    dashboard:null,
    scanTimer:null,
    dashTimer:null,
    scanStart:0,
    scanDuration:10000,
    selectedSSID:'',
    wifiPassword:'',
    selectedAddress:'',
    selectedTimezone:'',
    editingActive:false,
    lastInputActivity:0,
    // Drafts (used in events step)
    draftBirthday:{name:'',date:''},
    draftSingle:{name:'',date:'',color:'#ff8800'},
    draftSeries:{name:'',recur:'weekly',monthly_pos:'',weekdays:[],color:'#33aaff'},
    rebootWatching:false,
    otaStatus:null,
    otaTimer:null,
    _histKey:'',
    showWifiPassword:false
  };

  // ---- Farbpalette & Helfer (mobile freundlich) ----
  const STD_COLORS=[
    '#ffffff','#ff9800','#ff0000','#00ff00','#0000ff','#ffff00','#00ffff','#ff00ff','#00bfff'
  ];
  function colorChooser(name,initial){
    const wrap=h('div',{class:'color-chooser'});
    const hidden=h('input',{type:'hidden',name,value:initial||'#ffffff'});
    STD_COLORS.forEach(col=>{
      const btn=h('button',{type:'button',class:'swatch-small'+(col.toLowerCase()===(initial||'').toLowerCase()?' sel':''),style:'--c:'+col,onclick:ev=>{
        wrap.querySelectorAll('.swatch-small').forEach(s=>s.classList.remove('sel'));
        ev.currentTarget.classList.add('sel'); hidden.value=col;
      }},'');
      wrap.appendChild(btn);
    });
    const custom=h('input',{type:'color',class:'custom-color',value:initial||'#ffffff',oninput:e=>{ wrap.querySelectorAll('.swatch-small').forEach(s=>s.classList.remove('sel')); hidden.value=e.target.value; }});
    wrap.appendChild(custom); wrap.appendChild(hidden); return wrap;
  }

  // ---- Utility helpers ----
  const h=(tag,attrs={},...children)=>{
    const el=document.createElement(tag);
    for(const [k,v] of Object.entries(attrs||{})){
      if(k==='class') el.className=v; else if(k==='html') el.innerHTML=v; else if(k.startsWith('on')&&typeof v==='function') el.addEventListener(k.substring(2),v); else if(v!==false && v!=null) el.setAttribute(k,v===true?'':v);
    }
    for(const c of children.flat()){
      if(c==null) continue;
      if(typeof c==='string' || typeof c==='number' || typeof c==='boolean'){
        el.appendChild(document.createTextNode(String(c)));
      } else {
        el.appendChild(c);
      }
    }
    return el;
  };
  const api=async (url,opts={})=>{
    const r= await fetch(url,{...opts,headers:{'Content-Type':'application/json',...(opts.headers||{})}});
    const ct=r.headers.get('content-type')||'';
    if(!r.ok){
      // Erlaube für /api/dashboard einen 401/403 mit JSON-Body, damit Login-Gate gerendert werden kann
      if((r.status===401 || r.status===403) && url.includes('/api/dashboard') && ct.includes('application/json')){
        const j=await r.json(); j.__httpStatus=r.status; return j;
      }
      throw new Error(r.status+' '+r.statusText);
    }
    if(ct.includes('application/json')) return await r.json();
    return await r.text();
  };
  const toast=(msg,type='info',timeout=4000)=>{
    const text = (msg==null)? '' : String(msg);
    // Suppress empty error toasts (occurs sporadically when switching connections AP to home network)
    if(type==='error' && (!text || !text.trim())) return;
    const id=Date.now()+Math.random();
    const t={id,msg:text,type};
    State.toasts.push(t);renderToasts();
    if(timeout) setTimeout(()=>{State.toasts=State.toasts.filter(x=>x.id!==id);renderToasts();},timeout);
  };

  // Captive-Portal Erkennung (iOS/Android verwenden spezielle WebViews)
  function isCaptivePortalUA(){
    try{
      const ua=(navigator.userAgent||'');
      return /CaptiveNetwork|CaptivePortal|MiniBrowser/i.test(ua);
    }catch(_){ return false; }
  }

  function renderToasts(){
    let c=document.querySelector('.toast-container');
    if(!c){c=h('div',{class:'toast-container'});document.body.appendChild(c);}
    c.innerHTML='';
    State.toasts.forEach(t=>{
      c.appendChild(h('div',{class:'toast toast-'+t.type},t.msg));
    });
  }

  // ---- Wizard Steps ----
  function render(){
    const active=document.activeElement;
    const isEditable=active && ['INPUT','TEXTAREA','SELECT'].includes(active.tagName);
    let restoreKey=null; let caretPos=null; let restoreType=null;
    if(isEditable){
      restoreKey=active.getAttribute('data-fkey')||active.getAttribute('name')||active.id;
      restoreType=active.tagName;
      try{ if(active.selectionStart!=null) caretPos=active.selectionStart; }catch(_){}
    }
    app.innerHTML='';
    // Auth gate hard block: wenn Anmeldung erforderlich und nicht eingeloggt, nur Login anzeigen
    if(State.dashboard && State.dashboard.authRequired && !State.dashboard.authed){
      showLoginGate();
      return;
    }
    if(State.wizardMode) renderWizard(); else renderMain();
    // History handling: push only when view/step changes
    const key=(State.wizardMode?'wiz:'+State.step:'app:'+State.view+':'+(State.view==='Settings'? (State.subView||''):''));
    if(!State._histKey){
      try{ history.replaceState({app:1,wizard:State.wizardMode,step:State.step,view:State.view,sub:State.subView},''); }catch(_){ }
      State._histKey=key;
    } else if(State._histKey!==key){
      try{ history.pushState({app:1,wizard:State.wizardMode,step:State.step,view:State.view,sub:State.subView},''); }catch(_){ }
      State._histKey=key;
    }
    if(restoreKey){
      const el=document.querySelector(`[data-fkey="${restoreKey}"]`)||document.querySelector(`[name="${restoreKey}"]`)||document.getElementById(restoreKey);
      if(el && (!restoreType || el.tagName===restoreType)){
        el.focus({preventScroll:true});
        try{ if(caretPos!=null && el.setSelectionRange) el.setSelectionRange(caretPos,caretPos); }catch(_){}
      }
    }
  }

  function renderWizard(){
    // Fokus im Wizard merken
    let activeName=null, selStart=null, selEnd=null;
    const act=document.activeElement;
      if(act && ['INPUT','SELECT','TEXTAREA'].includes(act.tagName)){
      activeName=act.getAttribute('name')||act.id;
      try{ selStart=act.selectionStart; selEnd=act.selectionEnd; }catch(_){}}
    const wrap=h('div',{class:'wizard'});
  // Kids Wizard: 0 WLAN,1 Passwort (falls erforderlich),2 Adresse,3 Termine & Geburtstage,4 Fertig
    wrap.appendChild(h('div',{class:'steps'},
      [0,1,2,3,4].map(i=>h('span',{class: i===State.step?'active':''}))
    ));

  if(State.step===0){
    wrap.appendChild(h('h1',{},'Connect Wi‑Fi'));
    wrap.appendChild(h('p',{},'Join this setup Wi-Fi and then choose your home network.'));
  const list=h('div',{id:'wifi-list',class:'card'});
  list.appendChild(scanArea());
      wrap.appendChild(list);
      wrap.appendChild(h('div',{class:'divider'}));
  const form=h('form',{onsubmit:e=>{e.preventDefault();connectWifi(form)}});
  form.appendChild(h('label',{class:'field'},'SSID',h('input',{name:'ssid',required:true,placeholder:'Network',value:State.selectedSSID||'',oninput:e=>{State.selectedSSID=e.target.value;}})));
  const pwInput=h('input',{id:'wifi-password',name:'password',type: (State.showWifiPassword?'text':'password'),required:true,placeholder:'Password',value:State.wifiPassword||'',oninput:e=>{State.wifiPassword=e.target.value;}});
  const eyeBtn=h('button',{type:'button',class:'pw-toggle',title:(State.showWifiPassword?'Hide password':'Show password'),'aria-label':(State.showWifiPassword?'Hide password':'Show password'),onclick:()=>{ State.showWifiPassword=!State.showWifiPassword; try{ pwInput.setAttribute('type', State.showWifiPassword?'text':'password'); }catch(_){ } eyeBtn.textContent = State.showWifiPassword?'🙈':'👁'; eyeBtn.setAttribute('title', State.showWifiPassword?'Hide password':'Show password'); eyeBtn.setAttribute('aria-label', State.showWifiPassword?'Hide password':'Show password'); }}, State.showWifiPassword?'🙈':'👁');
  const pwWrap=h('div',{class:'pw-wrap'}, pwInput, eyeBtn);
  form.appendChild(h('label',{class:'field'},'Password',pwWrap));
    form.appendChild(h('div',{class:'actions'},h('button',{type:'submit'},'Connect')));
      wrap.appendChild(form);
      const hint=h('div',{class:'card'},
  h('p',{},'If no networks appear: move the device closer to the router, wait a moment and press "Refresh".'),
    h('p',{class:'small muted'},'After connecting, the device may switch to your home network. This page might be unavailable briefly.')
      ); 
      wrap.appendChild(hint);
    }
  else if(State.step===1){
  // Admin password / login step
      const mustSet = State.dashboard?.stage === 'adminpass';
      const needsLogin = (!!State.dashboard?.authRequired && !State.dashboard?.authed);
      if(mustSet){
  wrap.appendChild(h('h1',{},'Admin password'));
  wrap.appendChild(h('p',{},'Set a password for the web interface.'));
        const f=h('form',{onsubmit:e=>{e.preventDefault();setAdminPassword(f,true);}});
  f.appendChild(field('Password','pw','password',''));
  f.appendChild(field('Repeat','pw2','password',''));
        wrap.appendChild(f);
  wrap.appendChild(h('div',{class:'actions'}, h('button',{onclick:()=>{ setAdminPassword(f,true); }},'Save & Continue')));
      } else if(needsLogin){
  wrap.appendChild(h('h1',{},'Login'));
  wrap.appendChild(h('p',{},'Enter the existing admin password to continue.'));
        const f=h('form',{onsubmit:e=>{ e.preventDefault(); }});
  f.appendChild(field('Password','pw','password',''));
        wrap.appendChild(f);
        const onLogin = async ()=>{
          const data=Object.fromEntries(new FormData(f).entries()); const pw=(data.pw||'').trim(); if(!pw){ toast('Enter password','warn'); return; }
          try{ await api('/api/auth/login',{method:'POST',body:JSON.stringify({password:pw})}); toast('Logged in','success'); await refreshDashboard(true); State.step=2; render(); }
          catch(e){ toast('Wrong password','error'); }
        };
  wrap.appendChild(h('div',{class:'actions'}, h('button',{onclick:onLogin},'Login & Continue')));
      } else {
        // weder neu setzen noch Login nötig -> weiter
        State.step=2; render(); return;
      }
    } else if(State.step===2){
      // Address & location
    wrap.appendChild(h('h1',{},'Address & Location'));
    wrap.appendChild(h('p',{},'Address determines time zone and weather region.'));
      if(State.dashboard){
        wrap.appendChild(h('div',{class:'card'},
          h('p',{},'Wi‑Fi connection successful. Device reachable at:'),
          h('ul',{},
            h('li',{}, 'http://'+(State.dashboard.hostname? State.dashboard.hostname.toLowerCase() : 'remindikids')+'/'),
            h('li',{}, 'IP: '+(State.dashboard.ip||'-'))
          ),
          h('p',{class:'small muted'},'Tip: bookmark this page now for quick access.')
        ));
      }
  if(!State.selectedAddress) State.selectedAddress = State.dashboard?.address||'';
  if(!State.selectedTimezone) State.selectedTimezone = State.dashboard?.timezone||'Europe/Berlin';
  const form=h('form',{onsubmit:e=>{e.preventDefault();saveAddress(form);}});
  // Structured address inputs
  if(!State.addrPostal) State.addrPostal = State.dashboard?.postalCode||'';
  if(!State.addrCity) State.addrCity = State.dashboard?.city||'';
  if(!State.addrCountry) State.addrCountry = State.dashboard?.country||'DE';
  form.appendChild(h('div',{class:'field-row'},
  h('label',{class:'field compact'},'ZIP',h('input',{name:'postalCode',placeholder:'12345',value:State.addrPostal,oninput:e=>{State.addrPostal=e.target.value;}})),
  h('label',{class:'field compact'},'City',h('input',{name:'city',required:true,placeholder:'City',value:State.addrCity,oninput:e=>{State.addrCity=e.target.value;}})),
  h('label',{class:'field compact'},'Country',h('input',{name:'country',placeholder:'DE',value:State.addrCountry,oninput:e=>{State.addrCountry=e.target.value;}}))
  ));
  // Search button & results
  form.appendChild(h('div',{class:'actions'},
  h('button',{type:'button',class:'secondary',onclick:citySearch},'Search places')
  ));
  if(State.cityResults && State.cityResults.length){
  const list=h('div',{class:'card'}, h('p',{},'Select a result:'),
      ...State.cityResults.map(r=> h('button',{class:'secondary',onclick:()=>selectCityResult(r)}, `${r.name} (${r.admin1||''} ${r.country||''}) ${r.latitude.toFixed(2)},${r.longitude.toFixed(2)}`))
    );
    form.appendChild(list);
  }
  // Zeitzone & Koordinaten werden aus gewähltem Suchtreffer übernommen (kein separates Feld mehr)
  if(State.selectedCityResult){
    form.appendChild(h('div',{class:'card small'},
  h('p',{},'Selected: '+State.selectedCityResult.name+' ('+(State.selectedCityResult.admin1||'')+' '+(State.selectedCityResult.country||'')+')'),
      h('p',{class:'small muted'},'TZ: '+State.selectedCityResult.timezone+'  '+State.selectedCityResult.latitude.toFixed(2)+','+State.selectedCityResult.longitude.toFixed(2))
    ));
    // Save button only after a selection has been made
    form.appendChild(h('div',{class:'actions'},
  h('button',{type:'submit'},'Save')
    ));
  }
      wrap.appendChild(form);
  } else if(State.step===3){
  wrap.appendChild(h('h1',{},'Events & Birthdays'));
  wrap.appendChild(h('p',{},'Create recurring or single events and birthdays. You can also do this later in Settings.'));
      // Simple inline forms (reuse helper builders later in settings view)
      const section=h('div',{class:'grid'});
      // Birthday form
      const fb=h('form',{onsubmit:e=>{e.preventDefault();addBirthdayWizard(fb);}});
  fb.appendChild(fieldInline('Name','birthday_name','text',State.draftBirthday.name||'', 'birthday_name'));
  fb.querySelector('input[name=birthday_name]').addEventListener('input',e=>{State.draftBirthday.name=e.target.value;});
  fb.appendChild(fieldInline('Birthday','birthday_date','date',State.draftBirthday.date||'', 'birthday_date'));
  fb.querySelector('input[name=birthday_date]').addEventListener('input',e=>{State.draftBirthday.date=e.target.value;});
  fb.appendChild(h('div',{class:'actions'},h('button',{type:'submit'},'Add birthday')));
  section.appendChild(h('div',{class:'card'},h('header',{},h('h3',{},'Birthday')),fb));
      // Single event form
  const fs=h('form',{onsubmit:e=>{e.preventDefault();addSingleWizard(fs);}});
  fs.appendChild(fieldInline('Name','single_name','text',State.draftSingle.name||'', 'single_name'));
  fs.querySelector('input[name=single_name]').addEventListener('input',e=>{State.draftSingle.name=e.target.value;});
  fs.appendChild(fieldInline('Date','single_date','date',State.draftSingle.date||'', 'single_date'));
  fs.querySelector('input[name=single_date]').addEventListener('input',e=>{State.draftSingle.date=e.target.value;});
  const singleColorChooser=colorChooser('color',State.draftSingle.color||'#ff8800');
  singleColorChooser.addEventListener('input',e=>{ if(e.target && e.target.name==='color'){ State.draftSingle.color=e.target.value; }});
  fs.appendChild(labelWrap('Color',singleColorChooser));
  fs.appendChild(h('div',{class:'actions'},h('button',{type:'submit'},'Add single event')));
  section.appendChild(h('div',{class:'card'},h('header',{},h('h3',{},'Single event')),fs));
      // Series event form
  const fser=h('form',{onsubmit:e=>{e.preventDefault();addSeriesWizard(fser);}});
  fser.appendChild(fieldInline('Name','series_name','text',State.draftSeries.name||'', 'series_name'));
  fser.querySelector('input[name=series_name]').addEventListener('input',e=>{State.draftSeries.name=e.target.value;});
      // recurrence select
      const recurSel=h('select',{name:'recur',onchange:e=>{State.draftSeries.recur=e.target.value;toggleMonthlyPos(fser);}},
        h('option',{value:'weekly'},'Weekly'),
        h('option',{value:'biweekly'},'Bi‑weekly'),
        h('option',{value:'monthly'},'Monthly')
      );
      fser.appendChild(labelWrap('Recurrence',recurSel));
      // monthly position select
      const mPosSel=h('select',{name:'monthly_pos',style:'display:none',onchange:e=>{State.draftSeries.monthly_pos=e.target.value;}},
        h('option',{value:''},'- Position -'),
        h('option',{value:'1'},'First'),
        h('option',{value:'2'},'Second'),
        h('option',{value:'3'},'Third'),
        h('option',{value:'4'},'Fourth')
      );
      fser.appendChild(labelWrap('Monthly pos',mPosSel));
      // weekdays checkboxes
  const wdays=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
      const wdWrap=h('div',{class:'weekday-select'});
      wdays.forEach((lbl,i)=>{
        const idx=i+1; // 1..7
        const checked= Array.isArray(State.draftSeries.weekdays) && State.draftSeries.weekdays.includes(idx);
        const cb=h('label',{class:'wd'},h('input',{type:'checkbox',value:String(idx),name:'wd',checked:checked?true:false}),lbl);
        wdWrap.appendChild(cb);
      });
  fser.appendChild(labelWrap('Weekdays',wdWrap));
      const seriesColorChooser=colorChooser('color',State.draftSeries.color||'#33aaff');
      seriesColorChooser.addEventListener('input',e=>{ if(e.target && e.target.name==='color'){ State.draftSeries.color=e.target.value; }});
  fser.appendChild(labelWrap('Color',seriesColorChooser));
  fser.appendChild(h('div',{class:'actions'},h('button',{type:'submit'},'Add recurring event')));
  section.appendChild(h('div',{class:'card'},h('header',{},h('h3',{},'Recurring event')),fser));
      // Apply stored recurrence & monthly pos
      setTimeout(()=>{ recurSel.value=State.draftSeries.recur||'weekly'; toggleMonthlyPos(fser); if(recurSel.value==='monthly' && State.draftSeries.monthly_pos){ mPosSel.style.display=''; mPosSel.value=State.draftSeries.monthly_pos; } },0);
      // Update weekday draft on change
      fser.addEventListener('change',e=>{ if(e.target && e.target.name==='wd'){ State.draftSeries.weekdays = collectWeekdays(fser); }});
      wrap.appendChild(section);
      wrap.appendChild(h('div',{class:'actions'},
        h('button',{onclick:()=>{ sendWizardStage('done'); State.step=4; render(); }},'Done')
      ));
    } else if(State.step===4){
      wrap.appendChild(h('h1',{},'All set'));
      wrap.appendChild(h('p',{},'Your RemindiKids setup is complete.'));
      wrap.appendChild(h('div',{class:'actions'},h('button',{onclick:()=>{ localStorage.setItem('rcWizardDone','1'); sendWizardStage('done'); State.wizardMode=false; State.view='Dashboard'; render(); }},'Go to Dashboard')));
    }
    app.appendChild(wrap);
    // Versuche Fokus wiederherzustellen
    if(activeName){
      const el=app.querySelector(`[name="${activeName}"]`);
      if(el){ el.focus({preventScroll:true}); try{ if(selStart!=null && selEnd!=null && el.setSelectionRange) el.setSelectionRange(selStart, selEnd); }catch(_){ } }
    }
  // Return password input ref for focus restore
  if(State.step===0) return document.getElementById('wifi-password');
  return null;
  }

  function renderMain(){
    const header=h('header',{class:'appbar'},
      h('h1',{},'RemindiKids'),
      State.dashboard?.apMode? h('span',{class:'badge',style:'background:#b71c1c'},'AP MODE'):null,
      h('nav',{class:'tabs'},
  ['Dashboard','Settings'].map(name=>
          h('button',{class: State.view===name? 'active':'',onclick:()=>{State.view=name;render();}},name)
        )
      )
    );
    app.appendChild(header);
    if(!State.view) State.view='Dashboard';
    const main=h('main');
    if(State.view==='Dashboard'){
      main.appendChild(viewDashboard());
  } else if(State.view==='Settings'){
      main.appendChild(viewSettingsHub());
    }
    // Logout nur im Dashboard und unten über dem Footer anzeigen
    if(State.view==='Dashboard' && State.dashboard?.authRequired){
      const bottom=h('div',{class:'logout-bottom'},
        h('div',{class:'actions',style:'justify-content:center;margin:1rem 0'},
          h('button',{onclick:logout},'Logout')
        )
      );
      main.appendChild(bottom);
    }
    main.appendChild(h('footer',{},'Remindi © '+new Date().getFullYear()));
    app.appendChild(main);
  }

  // ---- Individual Views ----
  function statusDot(ok){return h('span',{class:'status-dot '+(ok===true?'status-online':ok===false?'status-offline':'status-unknown')});}
  function card(title,body,actions){
    const cardWrap=h('div',{class:'card'});
    cardWrap.appendChild(h('header',{},h('h3',{},title)));
    if(body) cardWrap.appendChild(body);
    if(actions){
      // Wenn body ein FORM ist, Actions in das Formular einbetten damit submit funktioniert
      const actWrap=h('div',{class:'actions'});
      if(Array.isArray(actions)) actions.forEach(a=>actWrap.appendChild(a)); else actWrap.appendChild(actions);
      if(body && body.tagName==='FORM') body.appendChild(actWrap); else cardWrap.appendChild(actWrap);
    }
    return cardWrap;
  }

  function viewDashboard(){
    const g=h('div',{class:'cards'});
    // Anzeige Box
    const tagsWrap=h('div',{class:'tags'});
      // Map internal names to human labels and filter allowed symbols
  const labelMap={ S1:'Morning', S2:'Forenoon', S3:'Noon', S4:'Afternoon', S5:'Evening', THERMO:'Thermometer', MOND:'Moon', REGEN:'Rain', RUCKSACK:'Backpack', HAUS:'Home', KALENDER:'Calendar', BAUM:'Tree', GESCHENK:'Gift' };
    function hexToRgb(hex){ if(!hex) return {r:0,g:0,b:0}; let h=hex.trim(); if(h[0]==='#') h=h.slice(1); if(h.length===3){ h=h.split('').map(c=>c+c).join(''); } const num=parseInt(h,16); return {r:(num>>16)&255,g:(num>>8)&255,b:num&255}; }
    function isLight(hex){ const {r,g,b}=hexToRgb(hex); // sRGB luminance
      const srgb=(v)=>{ v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4); };
      const L=0.2126*srgb(r)+0.7152*srgb(g)+0.0722*srgb(b);
      return L>0.6; }
    if(State.dashboard?.extra && Array.isArray(State.dashboard.extra)){
      const items = State.dashboard.extra
        .map(w=>({name:String(w.name||'').toUpperCase(), color: w.color||'#444'}))
        .filter(w=> labelMap[w.name]!=null);
      items.forEach(w=>{
        const label=labelMap[w.name]; const col=w.color; const light=isLight(col);
        // Filled chip with border; dynamic text color for contrast
        const style = `background:${col};border:1px solid ${col};color:${light?'#111':'#fff'}`;
        const tag=h('span',{class:'word-tag',style},label);
        tagsWrap.appendChild(tag);
      });
      if(!items.length){ tagsWrap.appendChild(h('span',{class:'muted'},'No symbols active')); }
    } else {
      tagsWrap.appendChild(h('span',{class:'muted'},'No data'));
    }
    // Strip leading 'KIDS' keyword from phrase for display
    let phrase = State.dashboard?.phrase || '—';
    if(typeof phrase==='string') phrase = phrase.replace(/^KIDS\s*/i,'').trim();
    const phraseEl=h('div',{class:'phrase'}, phrase);
  g.appendChild(card('Display',h('div',{}, phraseEl, tagsWrap)));
    // Services Box mit grünen/roten Kreisen
    const services=h('div',{},
  serviceLine('Time', State.dashboard?.timeSync),
      serviceLine('Weather', State.dashboard?.weather_ok),
      serviceLine('Events', State.dashboard?.birthdays)
    );
    g.appendChild(card('Services', services, h('button',{class:'secondary',onclick:refreshDashboard},'Refresh')));
    return g;
  }
  function serviceLine(label,ok){ return h('div',{class:'inline'},statusDot(ok===true),h('span',{},label)); }
  function statusLine(label,val){
  let ok=null; if(typeof val==='boolean') ok=val; if(label==='Current time' || label==='Time') ok=val && val!=='--:--';
    return h('div',{class:'inline'},statusDot(ok),h('span',{},label+': '+(val==null?'?':val)));
  }

  // Settings hub with subtabs
  function viewSettingsHub(){
    if(!State.subView || State.subView==='Allgemein') State.subView='Device';
    const wrap=h('div',{});
  const tabs=['Device','Brightness','Colors','Events','Time'];
    // Ensure valid tab selection
    if(!tabs.includes(State.subView)) State.subView='Device';
    wrap.appendChild(h('div',{class:'subtabs'}, tabs.map(t=> h('button',{class:State.subView===t?'active':'',onclick:()=>{State.subView=t; if(t==='Events' && !State.eventsLoaded) loadEvents(); render();}},t))));
    let content;
    switch(State.subView){
      case 'Device': content=viewDevice(); break;
    case 'Brightness': content=viewBrightness(); break;
  case 'Colors': content=viewColors(); break;
  case 'Events': content=viewEvents(); break;
  case 'Time': content=viewTime(); break;
    }
    wrap.appendChild(content);
    return wrap;
  }

  // --- Events view ---
  function viewEvents(){
    const wrap=h('div',{class:'grid'});
    const actions=h('div',{class:'actions'},
      h('button',{class:'secondary',onclick:loadEvents},'Refresh'));
    // Liste laden/anzeigen
    const list=h('div',{});
    // Local helpers for Events view
    const wdNames=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    function pad2(n){ return String(n).padStart(2,'0'); }
    function formatDateYMD(iso){
      // Expect YYYY-MM-DD; fallback to original if parse fails
      if(!iso || typeof iso!=='string') return iso||'';
      const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
      if(!m) return iso;
      const [_,y,mo,d]=m; return `${d}.${mo}.${y}`;
    }
    function hexToRgb(hex){ if(!hex) return {r:0,g:0,b:0}; let h=hex.trim(); if(h[0]==='#') h=h.slice(1); if(h.length===3){ h=h.split('').map(c=>c+c).join(''); } const num=parseInt(h,16); return {r:(num>>16)&255,g:(num>>8)&255,b:num&255}; }
    function isLight(hex){ const {r,g,b}=hexToRgb(hex); const srgb=v=>{ v/=255; return v<=0.03928? v/12.92 : Math.pow((v+0.055)/1.055,2.4); }; const L=0.2126*srgb(r)+0.7152*srgb(g)+0.0722*srgb(b); return L>0.6; }
    function nameChip(label,col){ const c=col||'#9ca3af'; const light=isLight(c); const style=`background:${c};border:1px solid ${c};color:${light?'#111':'#fff'}`; return h('span',{class:'word-tag',style},label||''); }
    function typeIcon(t){
      const type=(t||'').toLowerCase();
      if(type==='birthday'){
        // gift icon
        return h('span',{class:'ev-icon',title:'Birthday',html:'<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20 7h-2.18A3 3 0 0 0 12 5.83 3 3 0 0 0 6.18 7H4a1 1 0 0 0-1 1v3h18V8a1 1 0 0 0-1-1Zm-9-1a1 1 0 1 1 0-2c1.66 0 3 1.34 3 3v1h-1a2 2 0 0 1-2-2Zm-5 1a2 2 0 1 1 2-2 2 2 0 0 1-2 2ZM3 13v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6Zm9 0v8h-2v-8Z"/></svg>'});
      }
      // calendar icon (default)
      return h('span',{class:'ev-icon',title:'Event',html:'<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 2a1 1 0 0 0-1 1v1H5a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3h-1V3a1 1 0 1 0-2 0v1H8V3a1 1 0 0 0-1-1Zm12 8H5v9a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1Zm-1-5a1 1 0 0 1 1 1v2H5V6a1 1 0 0 1 1-1Z"/></svg>'});
    }
    function formatRecur(ev){
      const t=(ev.type||'').toLowerCase();
      if(t==='birthday') return 'yearly';
      const r=(ev.recur||'').toLowerCase();
      if(!r) return '';
      if(r==='weekly'){
        const days=Array.isArray(ev.weekdays)? ev.weekdays.map(n=>wdNames[(Math.max(1,Math.min(7,n))-1)]).join(','):'';
        return 'weekly'+(days?` (${days})`:'');
      }
      if(r==='biweekly'){
        const days=Array.isArray(ev.weekdays)? ev.weekdays.map(n=>wdNames[(Math.max(1,Math.min(7,n))-1)]).join(','):'';
        return 'bi-weekly'+(days?` (${days})`:'');
      }
      if(r==='monthly'){
        const pos=ev.monthly_pos? `${ev.monthly_pos}.` : '';
        let wd=''; if(Array.isArray(ev.weekdays) && ev.weekdays.length){ const n=Math.max(1,Math.min(7,ev.weekdays[0])); wd=wdNames[n-1]; }
        const extra=(pos||wd)?` (${pos}${wd})`:''; return 'monthly'+extra;
      }
      return r;
    }
    if(!State.eventsLoaded){ list.appendChild(h('p',{},'Loading...')); setTimeout(loadEvents,0); }
    else if(Array.isArray(State.events) && State.events.length){
      State.events.forEach(ev=>{
        const typeCol = h('div',{class:'ev-col ev-type'}, typeIcon(ev.type));
        const nameCol = h('div',{class:'ev-col'}, nameChip(ev.name||'', ev.color));
        const dateStr = ev.date ? formatDateYMD(ev.date) : (ev.month? `${pad2(ev.day)}.${pad2(ev.month)}` : '');
        let recurStr = formatRecur(ev);
        if(ev.type==='series' && ev.pause_until){
          const todayIso=new Date().toISOString().substring(0,10);
            if(todayIso < ev.pause_until){
              recurStr += ' (paused until '+ev.pause_until+')';
              if(ev.next_active) recurStr += ' → next: '+ev.next_active;
            }
        }
        // Pause icon for paused series (calendar replaced with pause)
        if(ev.type==='series' && ev.pause_until){
          // Compare pause_until against today (ISO). If today < pause_until -> paused
          try{ const todayIso=new Date().toISOString().substring(0,10); if(todayIso < ev.pause_until){
            typeCol.innerHTML='<span class="ev-icon" title="Paused"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M10 4a2 2 0 0 0-2 2v12a2 2 0 0 0 4 0V6a2 2 0 0 0-2-2Zm6 0a2 2 0 0 0-2 2v12a2 2 0 0 0 4 0V6a2 2 0 0 0-2-2Z"/></svg></span>';
          }}catch(_){/*ignore*/}
        }
        const row=h('div',{class:'event-row'},
          typeCol,
          nameCol,
          h('div',{class:'ev-col'}, dateStr),
          h('div',{class:'ev-col'}, recurStr),
          h('div',{class:'ev-col'},
            h('button',{class:'mini',onclick:()=>{ const t=(ev.type||'single'); openEventModal(t, ev); }},'Edit')
          )
        );
        list.appendChild(row);
      });
    } else {
      list.appendChild(h('p',{},'No events yet.'));
    }
    wrap.appendChild(card('Events',list,actions));
    // Formulare hinzufügen (Geburtstag, Einzel, Serie)
    const forms=h('div',{},
      buildBirthdayCard(),
      buildSingleCard(),
      buildSeriesCard()
    );
    wrap.appendChild(forms);
    return wrap;
  }

  // Small helper cards for adding events (used in Events view)
  function buildBirthdayCard(){
    const info=h('p',{class:'small muted'},'Repeats yearly (e.g., birthdays).');
    const actions=h('div',{class:'actions'},
      h('button',{onclick:()=>openEventModal('birthday', null)},'Add'));
    return card('Birthday', h('div',{}, info), actions);
  }
  function buildSingleCard(){
    const info=h('p',{class:'small muted'},'One-time event with date and optional color.');
    const actions=h('div',{class:'actions'},
      h('button',{onclick:()=>openEventModal('single', null)},'Add'));
    return card('Single', h('div',{}, info), actions);
  }
  function buildSeriesCard(){
    const info=h('p',{class:'small muted'},'Recurring: weekly, bi‑weekly or monthly (with weekdays).');
    const actions=h('div',{class:'actions'},
      h('button',{onclick:()=>openEventModal('series', null)},'Add'));
    return card('Recurring', h('div',{}, info), actions);
  }

  function viewDevice(){
    const d=State.dashboard||{};
    const wrap=h('div',{class:'grid'});
    // Order: Device info, Software Update, Update-moon, Restart, Factory reset
    const info=h('div',{},
      lineKV('IP', d.ip||'-'),
      lineKV('Wi‑Fi', [ (d.wifi_ssid? d.wifi_ssid:'-'), rssiIcon(d.wifi_rssi) ]),
      lineKV('Uptime', formatUptime(d.uptime_ms)),
      lineKV('Time zone', d.timezone||'-'),
      lineKV('Firmware', d.version||'?')
    );
    wrap.appendChild(card('Device info',info));
    wrap.appendChild(buildOtaCard());
    // Yellow moon when update available (old "UPDATE" word) can be toggled
    const updMode = (d.updateWordMode)|| (d.weatherWords && d.weatherWords.MOND && d.weatherWords.MOND.mode) || 'auto';
    const updWrap=h('div',{});
    const btnRow=h('div',{class:'inline-btns mode-buttons'});
    function renderUpdBtns(){
      btnRow.innerHTML='';
      [['auto','AUTO'],['disabled','AUS']].forEach(([m,label])=>{
        btnRow.appendChild(h('button',{class:'mini'+(updWrap.dataset.mode===m?' active':''),onclick:()=>{ updWrap.dataset.mode=m; renderUpdBtns(); }},label));
      });
    }
    updWrap.dataset.mode= (updMode==='disabled')? 'disabled':'auto';
    renderUpdBtns();
    const saveBtn=h('button',{onclick:async()=>{
      const mode=updWrap.dataset.mode;
      try {
        await api('/api/settings/weather-words',{method:'POST',body:JSON.stringify({ MOND:{ enabled: mode==='auto' } })});
        toast('Update-moon setting saved','success');
        await refreshDashboard(true);
      } catch(e){ toast('Save failed','error'); }
    }},'Save');
    updWrap.appendChild(h('p',{class:'small'},'Show a yellow moon when an update is available/active (AUTO or OFF).'));
    updWrap.appendChild(btnRow);
    updWrap.appendChild(h('div',{class:'actions'},saveBtn));
  wrap.appendChild(card('Update moon', updWrap));
    const restartBox=h('div',{},h('p',{},'Restart the device.'),h('button',{onclick:confirmRestart},'Restart'));
    wrap.appendChild(card('Restart',restartBox));
    const resetBox=h('div',{},
      h('p',{},'All saved configuration and data will be erased (Wi‑Fi, address/coordinates, events/birthdays, extra words, debug log, OTA state).'),
  h('p',{class:'small muted'},'After reset, the device starts in Access Point mode (SSID: remindiKids-Setup, see manual for password). The web UI is then available at http://192.168.4.1.'),
      h('button',{class:'danger',onclick:factoryResetConfirm},'Factory reset')
    );
    wrap.appendChild(card('Factory reset',resetBox));
    return wrap;
  }
  function buildOtaCard(){
    const box=h('div',{});
    const st=State.otaStatus;
    if(!st){ box.appendChild(h('p',{},'Loading OTA status...')); loadOTAStatus(); return card('Software Update',box); }
    if(st.hasUpdate){
      if(st.metadataVersion){
        box.appendChild(h('div',{class:'kv'},h('strong',{},'Available version: '),h('span',{},st.metadataVersion)));
      }
      if(st.changelog){
        box.appendChild(h('details',{},h('summary',{},'Show changelog'), h('pre',{style:'white-space:pre-wrap;font-size:0.75rem;'}, st.changelog)));
      }
      const btn=h('button',{class:'primary',onclick:()=>startOTAUpdate(btn,st.metadataVersion)},'Install update');
      box.appendChild(h('div',{class:'actions'},btn));
    } else {
      // Kein Update: aktuelle Version aus Dashboard falls vorhanden anzeigen
      const cur=State.dashboard?.version || st.metadataVersion || 'unknown';
      box.appendChild(h('p',{},'Firmware up to date: '+cur));
    }
    if(localStorage.getItem('rcPendingUpdateTarget')){
      box.appendChild(h('p',{class:'small'},'Updating – Please wait, device will reboot...'));
    }
    return card('Software Update', box);
  }
  async function loadOTAStatus(){ try { const s=await api('/api/ota/status'); State.otaStatus=s; } catch(e){} render(); }
  async function startOTAUpdate(btn,targetVersion){
    if(!confirm('Install update to version '+targetVersion+'?')) return;
    const done=setLoading(btn);
    try {
      const prevVer=State.dashboard?.version||'';
      if(targetVersion){
        localStorage.setItem('rcPendingUpdateTarget',targetVersion);
        localStorage.setItem('rcPendingUpdatePrev',prevVer);
        localStorage.setItem('rcPendingUpdateTs',String(Date.now()));
      }
      const r=await fetch('/api/ota/firmware',{method:'POST'});
      if(r.ok){
        toast('Update started – Please wait...');
        btn.disabled=true; btn.textContent='Please wait...';
        beginRebootWatch(true);
      } else {
        toast('Update start failed','error');
        localStorage.removeItem('rcPendingUpdateTarget');
        localStorage.removeItem('rcPendingUpdatePrev');
        localStorage.removeItem('rcPendingUpdateTs');
      }
    } catch(e){
      toast('Network error','error');
      localStorage.removeItem('rcPendingUpdateTarget');
      localStorage.removeItem('rcPendingUpdatePrev');
      localStorage.removeItem('rcPendingUpdateTs');
    } finally { done(); }
  }
  async function setAdminPassword(form, proceed){
    const data=Object.fromEntries(new FormData(form).entries());
    const pw=(data.pw||'').trim(); const pw2=(data.pw2||'').trim();
    if(pw.length<4){ toast('Password too short','warn'); return; }
    if(pw!==pw2){ toast('Passwords do not match','error'); return; }
    try{
  await api('/api/auth/set',{method:'POST',body:JSON.stringify({password:pw})});
      toast('Password set','success');
      await refreshDashboard();
  if(proceed){ State.step=2; render(); }
    } catch(e){
      const msg=(e&&e.message)||'';
      if(msg.startsWith('400')) toast('Password too short or invalid','error');
      else if(msg.startsWith('401')){ toast('Password already set – please login','warn'); await refreshDashboard(true); /* show login */ State.step=1; render(); }
      else toast('Failed to set password','error');
    }
  }
  function showLoginGate(){
    const existing=document.getElementById('login-gate'); if(existing) return;
    const gate=document.createElement('div'); gate.id='login-gate'; gate.className='login-gate';
    const box=document.createElement('div'); box.className='login-box';
    const h2=document.createElement('h2'); h2.textContent='Login required'; box.appendChild(h2);
    const form=document.createElement('form'); form.onsubmit=async (e)=>{ e.preventDefault(); const pw=form.querySelector('input[name=pw]').value; await doLogin(pw); };
    const lbl=document.createElement('label'); lbl.className='field'; lbl.textContent='Password';
    const inp=document.createElement('input'); inp.type='password'; inp.name='pw'; lbl.appendChild(inp);
    form.appendChild(lbl);
    const actions=document.createElement('div'); actions.className='actions';
    const btn=document.createElement('button'); btn.type='submit'; btn.textContent='Login'; actions.appendChild(btn);
  const forgot=document.createElement('button'); forgot.type='button'; forgot.className='secondary'; forgot.textContent='Forgot password'; forgot.onclick=()=>forgotPassword(); actions.appendChild(forgot);
    form.appendChild(actions);
    box.appendChild(form);
    gate.appendChild(box);
    document.body.appendChild(gate);
    setTimeout(()=>{ inp.focus(); },0);
  }
  async function doLogin(pw){
    try{ await api('/api/auth/login',{method:'POST',body:JSON.stringify({password:pw})}); toast('Logged in','success'); await refreshDashboard(true); const gate=document.getElementById('login-gate'); if(gate) gate.remove(); } catch(e){ toast('Wrong password','error'); }
  }
  async function logout(){ try{ await fetch('/api/auth/logout',{method:'POST'}); await refreshDashboard(true); showLoginGate(); }catch(e){} }
  async function forgotPassword(){
    if(!confirm('Perform factory reset? All data will be lost.')) return;
    try{
      await fetch('/api/settings/factory-reset/public',{method:'POST'});
    }catch(_){ /* ignore */ }
    // Zeige sofort Hinweis + Reboot-Watch
    toast('Factory reset enabled. Device will reboot...','warn');
    beginRebootWatch(true);
  }
  function lineKV(k,v){
    const valSpan=h('span',{});
    if(Array.isArray(v)) v.forEach(x=>{ if(typeof x==='string') valSpan.appendChild(document.createTextNode(x)); else if(x) valSpan.appendChild(x); });
    else if(typeof v==='string' || typeof v==='number') valSpan.textContent=String(v);
    else if(v && v.nodeType) valSpan.appendChild(v); // DOM node
    else if(v!==undefined && v!==null) valSpan.textContent=String(v);
    return h('div',{class:'kv'},h('strong',{},k+': '),valSpan);
  }
  function rssiIcon(r){
    if(r==null) return '';
    let lvl=1; if(r>-55) lvl=4; else if(r>-65) lvl=3; else if(r>-75) lvl=2; else lvl=1;
    const bars=[1,2,3,4].map(i=>{
      const active = i<=lvl;
      const bh=4+i*3; // steigende Höhe
      const x=(i-1)*4;
      const y=16-bh;
      return `<rect x="${x}" y="${y}" width="3" height="${bh}" rx="1" fill="${active?'#0af':'#ccc'}"/>`;
    }).join('');
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="18" height="16" viewBox="0 0 16 16" style="vertical-align:middle;margin-left:4px">${bars}</svg>`;
    return h('span',{class:'wifi-rssi',html:svg});
  }
  function formatUptime(ms){ if(!ms && ms!==0) return '-'; const s=Math.floor(ms/1000); const d=Math.floor(s/86400); const h=Math.floor((s%86400)/3600); const m=Math.floor((s%3600)/60); let out=''; if(d) out+=d+'d '; out+=String(h).padStart(2,'0')+':'+String(m).padStart(2,'0'); return out; }
  function confirmRestart(){ if(!confirm('Really restart the device?')) return; fetch('/api/restart',{method:'POST'}).then(()=>toast('Restart triggered')); }
  function factoryResetConfirm(){
    if(!confirm('All saved configurations and data will be permanently deleted. Continue?')) return;
    factoryReset();
  }

  function viewBrightness(){
    const c=h('div',{class:'grid'});
    const f=h('form',{onsubmit:e=>{e.preventDefault();saveBrightness(f);}});
  // Map rawBrightness (1..255) to percentage (1..100)
  const raw=State.dashboard?.rawBrightness||128;
  const pct=Math.min(100,Math.max(1, Math.round(raw*100/255)));
  f.appendChild(h('label',{class:'field'},'Brightness',h('input',{type:'range',name:'brightnessPercent',min:1,max:100,value:pct,oninput:e=>{e.target.nextSibling.textContent=e.target.value+'%';}}),h('span',{},pct+'%')));
    const nightSel=h('select',{name:'night'},
      h('option',{value:'off'},'Off'),
      h('option',{value:'on'},'On')
    );
    const currentNight = (State.dashboard?.nightModeRaw==='on')? 'on':'off';
    setTimeout(()=>{ nightSel.value=currentNight; toggleNightFields(); },0);
  f.appendChild(h('label',{class:'field'},'Night mode',nightSel));
    // Night schedule fields
    const nfWrap = h('div',{class:'night-fields'});
    const nh = State.dashboard?.nightStartHour ?? 22;
    const nm = State.dashboard?.nightStartMinute ?? 0;
    const eh = State.dashboard?.nightEndHour ?? 6;
    const em = State.dashboard?.nightEndMinute ?? 0;
    const nb = State.dashboard?.nightBrightness ?? 30;
    nfWrap.appendChild(h('label',{class:'field'},'Start (HH:MM)',
      h('input',{type:'number',name:'nightStartHour',min:0,max:23,value:nh,style:'width:70px'}),
      h('input',{type:'number',name:'nightStartMinute',min:0,max:59,value:nm,style:'width:70px'})));
    nfWrap.appendChild(h('label',{class:'field'},'End (HH:MM)',
      h('input',{type:'number',name:'nightEndHour',min:0,max:23,value:eh,style:'width:70px'}),
      h('input',{type:'number',name:'nightEndMinute',min:0,max:59,value:em,style:'width:70px'})));
  nfWrap.appendChild(h('label',{class:'field'},'Night brightness',h('input',{type:'range',name:'nightBrightness',min:1,max:255,value:nb,oninput:e=>{e.target.nextSibling.textContent=e.target.value;} }),h('span',{},nb)));
    f.appendChild(nfWrap);
    nightSel.onchange=()=>{ toggleNightFields(); };
    function toggleNightFields(){ nfWrap.style.display = (nightSel.value==='on')? 'block':'none'; }
  const baseColor = (State.dashboard?.color && /^#?[0-9a-fA-F]{6}$/.test(State.dashboard.color))? (State.dashboard.color.startsWith('#')? State.dashboard.color : '#'+State.dashboard.color) : '#ffffff';
  f.appendChild(h('label',{class:'field'},'Clock',h('input',{type:'color',name:'color',value:baseColor}))); // renamed
    c.appendChild(card('LED settings',f,h('button',{type:'submit'},'Apply')));
  // Removed 'Farben Zusatzwörter' card per request
    return c;
  }

  // Zeit (Unterscheidung Wochentag/Wochenende, mit Ferien-Schalter)
  function viewTime(){
    const wrap=h('div',{class:'grid'});
    const d=State.dashboard||{};
    const day = Array.isArray(d.dayStartMinutes)? d.dayStartMinutes : [420,420,420,420,420,540,540];
    const night = Array.isArray(d.nightStartMinutes)? d.nightStartMinutes : [1200,1200,1200,1200,1200,1200,1200];
    const vac = !!(d.vacationMode||d.holidayMode);
    const f=h('form',{onsubmit:e=>{e.preventDefault();saveSchedule(f);}});
  // Week/Weekend
    const wdDay = Math.min(...day.slice(0,5));
    const wdNight = Math.min(...night.slice(0,5));
    const weDay = Math.min(day[5], day[6]);
    const weNight = Math.min(night[5], night[6]);
    f.appendChild(h('label',{class:'field'},'Weekday',
      h('div',{class:'inline'},
        h('input',{type:'time',name:'wd_day',value: minutesToHHMM(wdDay)}),
        h('input',{type:'time',name:'wd_night',value: minutesToHHMM(wdNight)})
      )));
    f.appendChild(h('label',{class:'field'},'Weekend',
      h('div',{class:'inline'},
        h('input',{type:'time',name:'we_day',value: minutesToHHMM(weDay)}),
        h('input',{type:'time',name:'we_night',value: minutesToHHMM(weNight)})
      )));
    // Vacation toggle
    const vacWrap=h('div',{class:'inline-btns mode-buttons',style:'margin-top:.75rem'});
    let vacState=vac?'on':'off';
    const hiddenVac=h('input',{type:'hidden',name:'vac',value: vac?'on':'off'});
    function setVacMode(mode){
      vacState = mode==='on'?'on':'off';
      hiddenVac.value = vacState;
      const btns = vacWrap.querySelectorAll('button[data-mode]');
      btns.forEach(b=>{ const m=b.getAttribute('data-mode'); if(m===vacState) b.classList.add('active'); else b.classList.remove('active'); });
    }
    function renderVac(){
      vacWrap.innerHTML='';
      [['on','ON'],['off','OFF']].forEach(([v,l])=>{
        const btn=h('button',{type:'button','data-mode':v,class:'mini'+(vacState===v?' active':''),onclick:()=>setVacMode(v)}, l);
        vacWrap.appendChild(btn);
      });
    }
    renderVac();
  f.appendChild(h('div',{}, h('label',{},'Vacation'), vacWrap));
  f.appendChild(h('div',{class:'actions'}, h('button',{type:'submit'},'Save')));
    // hidden input to submit current mode
    f.appendChild(hiddenVac);
  wrap.appendChild(card('Schedule',f));
    // Time zone and manual offset form
    const tzForm=h('form',{onsubmit:e=>{ e.preventDefault(); saveTimeSettings(tzForm); }});
    const tzVal = d.timezone || 'Europe/Berlin';
    const offVal = (typeof d.timeOffsetMinutes==='number')? d.timeOffsetMinutes : 0;
    tzForm.appendChild(h('label',{class:'field'},'Time zone', h('input',{type:'text',name:'timezone',value:tzVal,placeholder:'Europe/Berlin or UTC+05:30 or POSIX:EST5EDT,...'})));
    tzForm.appendChild(h('label',{class:'field'},'Manual offset (minutes)', h('input',{type:'number',name:'timeOffsetMinutes',value:String(offVal),min:-720,max:720,step:1,placeholder:'0'})));
  wrap.appendChild(card('Time zone & offset', tzForm, h('button',{type:'submit',onclick:(e)=>{ e.preventDefault(); saveTimeSettings(tzForm); }}, 'Save')));
    return wrap;
  }
  function minutesToHHMM(m){ const h=Math.floor((m||0)/60), mi=(m||0)%60; return String(h).padStart(2,'0')+':'+String(mi).padStart(2,'0'); }
  function hhmmToMinutes(s){ if(!s||typeof s!=='string') return 0; const [h,mi]=s.split(':'); const hh=parseInt(h||'0',10), mm=parseInt(mi||'0',10); let v=hh*60+mm; if(v<0) v=0; if(v>1439) v=1439; return v; }
  async function saveSchedule(form){
    const data=Object.fromEntries(new FormData(form).entries());
    const payload={
      weekday:{ day: hhmmToMinutes(data.wd_day), night: hhmmToMinutes(data.wd_night) },
      weekend:{ day: hhmmToMinutes(data.we_day), night: hhmmToMinutes(data.we_night) },
      holiday: (data.vac==='on')
    };
  try{ await api('/api/time/schedule',{method:'POST',body:JSON.stringify(payload)}); toast('Saved','success'); await refreshDashboard(true); } catch(e){ toast('Error','error'); }
  }

  async function saveTimeSettings(form){
    const data=Object.fromEntries(new FormData(form).entries());
    const tz=(data.timezone||'').trim();
    let off=parseInt(data.timeOffsetMinutes||'0',10); if(isNaN(off)) off=0; if(off<-720) off=-720; if(off>720) off=720;
    const payload={}; if(tz) payload.timezone=tz; payload.timeOffsetMinutes=off;
    try{ await api('/api/time/settings',{method:'POST', body: JSON.stringify(payload)}); toast('Time settings saved','success'); await refreshDashboard(true); }
    catch(e){ toast('Save failed','error'); }
  }

  function viewColors(){
    const wrap=h('div',{class:'grid'});
    // Symbols section
    const sForm=h('form',{onsubmit:e=>{e.preventDefault();saveSymbols(sForm);}});
    const defs={
      THERMO:{label:'Thermometer', color:null},
      RUCKSACK:{label:'Backpack', color:'#00FF00'},
      HAUS:{label:'Home', color:'#00FF00'},
      MOND:{label:'Moon', color:'#FFFFFF'},
      BAUM:{label:'Tree', color:null},
      GESCHENK:{label:'Gift', color:null},
      KALENDER:{label:'Calendar', color:null},
      REGEN:{label:'Rain', color:'#0000FF'},
      SCHNEE:{label:'Snow', color:'#FFFFFF'}
    };
    // Order: Thermometer, Kalender, Baum, Geschenk, Mond, Regen, Rucksack, Haus
  const keys=['THERMO','KALENDER','BAUM','GESCHENK','MOND','REGEN','SCHNEE','RUCKSACK','HAUS'];
    keys.forEach(k=>{
      let mode='auto'; let col=defs[k].color;
      const cur=State.dashboard?.symbols && State.dashboard.symbols[k];
      if(cur){ if(cur.mode) mode=cur.mode; if(cur.color && /^#?[0-9a-fA-F]{6}$/.test(cur.color)) col= cur.color.startsWith('#')? cur.color : '#'+cur.color; }
      const row=h('div',{class:'field'},
        // Symbol name
        h('span',{style:'min-width:120px;display:inline-block;font-weight:600;'}, defs[k].label),
        // Mode buttons first: AUTO then AUS
        (function(){
          const wrap=h('span',{class:'mode-buttons',style:'margin-left:8px;display:inline-flex;gap:4px;'});
          function makeBtn(label,val){
            const active=(mode==='auto'&&val==='auto')||(mode==='disabled'&&val==='disabled');
            return h('button',{type:'button','data-key':k,'data-mode':val,class:active?'mini active':'mini',onclick:()=>{ setMode(k,val,wrap,sForm); }},label);
          }
          wrap.appendChild(makeBtn('AUTO','auto'));
          wrap.appendChild(makeBtn('OFF','disabled'));
          return wrap;
        })(),
        // Color picker only for supported symbols, shown after buttons
  ((col!=null && (k==='RUCKSACK'||k==='HAUS'||k==='MOND'||k==='REGEN'||k==='SCHNEE'))
          ? h('input',{type:'color',name:k+'_col',value: col||'#FFFFFF',style:'margin-left:8px'})
          : null)
      );
      sForm.appendChild(row);
      // hidden input initial
      sForm.appendChild(h('input',{type:'hidden',name:k+'_mode',value:(mode==='auto'?'auto':'disabled')}));
    });
  sForm.appendChild(h('div',{class:'actions'}, h('button',{type:'submit'},'Save')));
    wrap.appendChild(card('Symbols', sForm));
    return wrap;
  }

  function setMode(key,mode,wrap,form){
    const btns=wrap.querySelectorAll('button'); btns.forEach(b=>{ b.classList.remove('active'); if(b.getAttribute('data-mode')===mode) b.classList.add('active'); });
    let hidden=form.querySelector('input[name="'+key+'_mode"]'); if(!hidden){ hidden=h('input',{type:'hidden',name:key+'_mode'}); form.appendChild(hidden); }
    hidden.value=mode;
  }

  async function saveSymbols(form){
    const data=Object.fromEntries(new FormData(form).entries());
  const keys=['THERMO','KALENDER','BAUM','GESCHENK','MOND','REGEN','SCHNEE','RUCKSACK','HAUS'];
    const payload={};
    keys.forEach(k=>{
      const enabled = (data[k+'_mode']||'auto')==='auto';
      const col = data[k+'_col'];
      payload[k] = { enabled };
      if(col) payload[k].color = col;
    });
  try{ await api('/api/settings/symbols',{method:'POST',body:JSON.stringify(payload)}); toast('Symbols saved','success'); await refreshDashboard(true); } catch(e){ toast('Save error','error'); }
  }
  // MQTT UI entfernt
  function showEventInfo(type){
    let txt=''; let title='Info';
    if(type==='birthday'){
      title='Birthdays info';
      txt='Add a reminder for stored birthdays of family or friends. The GEBURTSTAG word lights up automatically every year on the correct date.';
    } else if(type==='single'){
      title='Single event info';
      txt='Be reminded of an important appointment in your preferred color. Add an event and your RemindiClock will show the TERMIN word on the day.';
    } else if(type==='series'){
      title='Recurring event info';
      txt='Set up recurring reminders in your preferred color. Add a recurring event and your RemindiClock will show the TERMIN word on that day. Choose the repetition (weekly, bi-weekly, or monthly) and the weekday. For monthly, also choose if it should be the 1st, 2nd, 3rd or 4th occurrence of that weekday in the month.';
    }
    const body=document.createElement('div');
    txt.split(/\n\n/).forEach(p=>{ body.appendChild(document.createElement('p')).textContent=p; });
    showModal(title, body);
  }

  function viewMQTT(){
  const f=h('form',{id:'mqtt-form',onsubmit:e=>{e.preventDefault();saveMQTT(f);}});
  // Vorhandene Werte aus Dashboard übernehmen (falls vorhanden)
  const dash=State.dashboard||{};
  f.appendChild(field('Broker','broker','text',dash.mqttBroker||''));
  f.appendChild(field('Port','port','number',dash.mqttPort!=null?dash.mqttPort:1883));
  f.appendChild(field('Client ID','client','text',dash.mqttClientId||'RemindiClock'));
  f.appendChild(field('Username','user','text',dash.mqttUser||''));
  // Never prefill password; show placeholder if already set
  const passField=h('label',{class:'field'},'Password',h('input',{name:'pass',type:'password',placeholder: dash.mqttHasPassword? '********':''}));
  f.appendChild(passField);
  f.appendChild(field('Base topic','base','text',dash.mqttBase||'RemindiClock'));
  const saveBtn=h('button',{type:'submit'},'Save');
  const infoBtn=h('button',{type:'button',class:'secondary',onclick:showMqttHelp},'MQTT Help');
  const c=card('MQTT connection',f,h('div',{class:'actions'},saveBtn,infoBtn));
  // After first render of card, inject restart hint if pending
  setTimeout(()=>{ if(State.mqttNeedsRestart) showRestartHint(); },0);
  return c;
  }

  function showMqttHelp(){
  const dash=State.dashboard||{}; const base=dash.mqttBase||'RemindiClock';
    const wEx=base+'/word/BTC';
    const body=h('div',{},
      h('p',{},'MQTT structure – Base topic: '+base),
      h('pre',{class:'mono small',style:'white-space:pre-wrap'},
        '# Topics per word (example BTC)\n'+
        wEx+'/set    (commands)\n'+
        wEx+'/on     (retained true|false)\n'+
        wEx+'/mode   (retained mqtt|auto|disabled)\n'+
        wEx+'/color  (retained #RRGGBB or empty)\n\n'+
        '# Commands (topic <base>/word/<WORD>/set)\n'+
        'Simple string:\n'+
        '  mqtt\n  auto\n  disabled\n  on\n  off\n  on #FF8800\n\n'+
        'JSON variants:\n'+
        '  { "mode":"auto" }\n'+
        '  { "mode":"mqtt" }\n'+
        '  { "mode":"disabled" }\n'+
        '  { "command":"on", "color":"#00FF00" }\n'+
        '  { "command":"off" }\n\n'+
        '# Rules\n'+
        '- mode sets operating mode (auto|mqtt|disabled).\n'+
        '- on/off (or command) only works when current mode is mqtt.\n'+
        '- color only together with turning on (on or command:on); format #RRGGBB.\n'+
        '- /on and /color mirror the real status (auto changes immediately).\n\n'+
        '# Additional topics\n'+
        base+'/status            (Online/Offline)\n'+
        base+'/time              (current time HH:MM)\n'+
        base+'/brightness/set    (1-100)\n\n'+
        '# Home Assistant\n'+
        'Use /on as state_topic, /mode for availability/mode, /color optionally as attribute.')
    );
    showModal('MQTT Help', body);
  }

  // Generic modal helper (simple info modal)
  function showModal(titleText, content){
    const existing=document.getElementById('modal-backdrop'); if(existing) existing.remove();
    const backdrop=document.createElement('div'); backdrop.id='modal-backdrop'; backdrop.className='modal-backdrop';
    backdrop.addEventListener('click',e=>{ if(e.target===backdrop) backdrop.remove(); });
    const modal=document.createElement('div'); modal.className='modal';
    const closeBtn=document.createElement('button'); closeBtn.className='modal-close'; closeBtn.type='button'; closeBtn.textContent='×'; closeBtn.onclick=()=>backdrop.remove();
    const title=document.createElement('h2'); title.textContent=titleText||'';
    modal.appendChild(closeBtn);
    modal.appendChild(title);
    if(typeof content==='string'){
      const p=document.createElement('p'); p.textContent=content; modal.appendChild(p);
    } else if(content){
      modal.appendChild(content);
    }
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    // Basic ESC close
    const escHandler=(ev)=>{ if(ev.key==='Escape'){ backdrop.remove(); document.removeEventListener('keydown',escHandler); } };
    document.addEventListener('keydown',escHandler);
    // Focus first focusable
    setTimeout(()=>{ const btn=modal.querySelector('button:not(.modal-close)'); (btn||closeBtn).focus(); },0);
  }

  // Removed markets UI in Kids version

  function field(label,name,type='text',value='',readonly){
    return h('label',{class:'field'},label,h('input',{name,type,value,readonly:readonly?true:false}));
  }

  // ---- Actions (API placeholders) ----
  async function startScan(){
    try{
      State.scanning=true; State.scanStart=Date.now(); State.scanDuration=8000; State.networks=[]; render();
      await api('/api/wifi/scan/start',{method:'POST'});
      // Poll until done
      const poll=async()=>{
        try{ const res=await api('/api/wifi/scan'); if(res && res.scanning===false){ State.scanning=false; State.networks = res.networks||[]; render(); return; } }
        catch(_){ }
        setTimeout(poll, 800);
      }; poll();
  }catch(_){ State.scanning=false; toast('Scan failed','error'); render(); }
  }
  function selectNetwork(ssid){ State.selectedSSID=ssid; render(); }
  async function connectWifi(form){
    const data=Object.fromEntries(new FormData(form).entries()); const ssid=(data.ssid||'').trim(); const pw=(data.password||'');
  if(!ssid){ toast('Enter SSID','warn'); return; }
    const btn=form.querySelector('button[type=submit]'); const done=setLoading(btn);
    try{
        const res = await api('/api/wifi/connect',{method:'POST',body:JSON.stringify({ssid:ssid,password:pw})});
  toast('Wi‑Fi saved – connecting…','success');
        // Async Poll Modal
        const box=document.createElement('div');
        const progOuter=document.createElement('div'); progOuter.className='progress-wrap';
        const progBar=document.createElement('div'); progBar.className='progress-bar'; progBar.style.width='0%'; progOuter.appendChild(progBar);
    const statusP=document.createElement('p'); statusP.innerHTML='<strong>Searching for IP...</strong>';
  const ipP=document.createElement('p'); ipP.textContent='IP: (not yet)';
        const host = (res.hostname || 'remindikids').toLowerCase();
  const hostBtn=document.createElement('button'); hostBtn.type='button'; hostBtn.textContent='Check hostname'; hostBtn.disabled=true; hostBtn.className='btn-hostname-pruefen'; hostBtn.onclick=()=>window.open('http://'+host+'/', '_blank');
    const ipBtn=document.createElement('button'); ipBtn.type='button'; ipBtn.textContent='Open'; ipBtn.disabled=true; ipBtn.onclick=()=>{ if(window.__lastWifiIP) window.open('http://'+window.__lastWifiIP+'/', '_blank'); };
        const actions=document.createElement('div'); actions.className='actions-compact'; actions.appendChild(ipBtn); actions.appendChild(hostBtn);
  const timeoutHint=document.createElement('p'); timeoutHint.className='small muted'; timeoutHint.textContent='If no IP is found: try via hostname or your router’s device list.';
        box.appendChild(statusP); box.appendChild(progOuter); box.appendChild(ipP); box.appendChild(actions); box.appendChild(timeoutHint);
  showModal('Home network connection', box);
        const start=Date.now(); const MAX=30000; let stopped=false;
        const poll=async()=>{
          if(stopped) return;
          try{ const st=await api('/api/wifi/sta-status');
            const elapsed=Date.now()-start; const pct=Math.min(100, (elapsed/MAX)*100); progBar.style.width=pct+'%';
            if(st.connected && st.ip){ window.__lastWifiIP=st.ip; ipP.textContent='IP: '+st.ip+' (please note)'; statusP.innerHTML='<strong>Connected</strong>'; ipBtn.disabled=false; hostBtn.disabled=false; progBar.style.width='100%'; stopped=true; return; }
            if(elapsed>=MAX){ statusP.innerHTML='<strong>Continue via hostname</strong>'; hostBtn.disabled=false; stopped=true; progBar.style.width='100%'; return; }
          }catch(_){ /* ignore transient errors */ }
          setTimeout(poll,800);
        }; poll();
    }catch(e){
  toast('Start failed – please try again','error');
    } finally {
      try{ done(); }catch(_){ }
    }
  }
  async function citySearch(){
  const q=(State.addrCity||'').trim(); if(!q){ toast('Please enter a city','warn'); return; }
    try{ const res=await api('/api/geocode?city='+encodeURIComponent(q));
      if(res && res.ok && Array.isArray(res.results) && res.results.length){ State.selectedCityResult = res.results[0]; toast('Selected: '+State.selectedCityResult.name,'success'); render(); }
      else { toast('No results','warn'); }
    }catch(_){ toast('Search failed','error'); }
  }
  function scanArea(){
    const box=h('div',{});
    if(!State.scanning && !State.networks.length){
  box.appendChild(h('p',{},'No scan yet.'));
  box.appendChild(h('button',{onclick:startScan},'Start scan'));
    } else if(State.scanning){
      const prog=h('div',{class:'progress-wrap'},
        h('div',{class:'progress-bar',style:'width:0%'}));
  box.appendChild(h('p',{},'Scanning ('+Math.round(State.scanDuration/1000)+'s)...'));
      box.appendChild(prog);
      const update=()=>{
        if(!State.scanning) return;
        const el=prog.querySelector('.progress-bar');
        const pct=Math.min(100, ((Date.now()-State.scanStart)/State.scanDuration)*100);
        el.style.width=pct+'%';
        if(pct<100) requestAnimationFrame(update);
      }; update();
    } else {
      // show results + refresh button
      const list=h('div',{class:'net-list'});
      const nets=State.networks.slice().sort((a,b)=>(b.rssi||0)-(a.rssi||0));
      nets.forEach(net=>{
        const ssid=net.ssid||net.SSID||'';
        const r=net.rssi!=null? net.rssi : -100;
        let lvl=1; if(r>=-55) lvl=4; else if(r>=-65) lvl=3; else if(r>=-75) lvl=2; else lvl=1;
        const cls='secondary'+(ssid===State.selectedSSID?' active':'');
        list.appendChild(h('button',{class:cls,onclick:()=>selectNetwork(ssid),title:ssid+' ('+r+' dBm)'},
          h('span',{class:'wifi-item'},
            h('span',{class:'wifi-name'},ssid),
            h('span',{class:'wifi-icon lvl'+lvl},
              h('span',{class:'b1'}),
              h('span',{class:'b2'}),
              h('span',{class:'b3'}),
              h('span',{class:'b4'})
            )
          )
        ));
      });
  if(!nets.length) list.appendChild(h('p',{},'No networks found.'));
      box.appendChild(list);
  box.appendChild(h('div',{class:'actions'},h('button',{onclick:startScan},'Refresh')));
    }
    return box;
  }
  // Entfernte Post-Setup Hinweisfunktion
  async function saveAddress(form){
  const data={ postalCode:State.addrPostal, city:State.addrCity, country:State.addrCountry };
    try {
      if(State.selectedCityResult){
        data.latitude=State.selectedCityResult.latitude;
        data.longitude=State.selectedCityResult.longitude;
        data.timezone=State.selectedCityResult.timezone;
        data.city=State.selectedCityResult.name;
      }
      await api('/api/address',{method:'POST',body:JSON.stringify(data)});
  toast('Address + location saved','success');
  // Nach Adresseingabe direkt zu Schritt 3 (Events) wechseln
  await refreshDashboard();
  State.wizardMode=true;
  State.step=3;
  render();
  }catch(e){ toast('Save failed','error'); }
  }
  function sendWizardStage(stage){
    try{ fetch('/api/wizard/stage',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'stage='+encodeURIComponent(stage)}); }catch(_){ }
  }
  // Zweiter MQTT Block entfernt
  function schedulePoll(mode, delayMs){
    State.pollMode=mode; State.nextPollTs=Date.now()+delayMs; State.pollAttempts=0;
  }
  function continuePoll(delayMs){ State.nextPollTs=Date.now()+delayMs; }
  function stopPoll(){ State.pollMode='none'; }
  // Neu hinzugefügt: minimaler Poll für Wizard Stages (vereinfachte Kids-Version)
  async function targetedPollOnce(){
    try {
      await refreshDashboard(false,{suppressWizard:true});
    } catch(_){ }
  }
  function pollForStage(){
    if(!State.wizardMode) { stopPoll(); return; }
    const st = State.dashboard?.stage;
    if(st==='wifi'){ // wiederholt WLAN Status abfragen
      schedulePoll('wifi',300);
    } else {
      stopPoll();
    }
  }
  // Haupt-Poll Schleife (leichtgewichtig)
  if(!window.__wizPollLoop){
    window.__wizPollLoop = setInterval(async ()=>{
      if(!State.wizardMode || State.pollMode==='none') return;
      if(Date.now() < State.nextPollTs) return;
      State.pollAttempts++;
      await targetedPollOnce();
      // Logik pro Modus
      if(State.pollMode==='wifi'){ // warten bis Stage != wifi
        if(State.dashboard?.stage!=='wifi'){ stopPoll(); return; }
        if(State.pollAttempts>15){ stopPoll(); return; } // Timeout ~ anpassbar
        continuePoll(1500);
      }
    },400);
  }
  async function refreshDashboard(force, opts){
  opts=opts||{}; const suppressWizard=!!opts.suppressWizard;
  const prevStage = State.dashboard?.stage;
  try { State.dashboard = await api('/api/dashboard'); } catch(e){ }
    // OTA Erfolg / Fehlschlag über Versionsvergleich erkennen
    try {
      const tgt=localStorage.getItem('rcPendingUpdateTarget');
      const prevVer=localStorage.getItem('rcPendingUpdatePrev');
      const ts=parseInt(localStorage.getItem('rcPendingUpdateTs')||'0',10);
      if(tgt && prevVer && State.dashboard?.version){
        if(State.dashboard.version===tgt){
          toast('Update installiert ('+tgt+')','success');
          localStorage.removeItem('rcPendingUpdateTarget');
          localStorage.removeItem('rcPendingUpdatePrev');
          localStorage.removeItem('rcPendingUpdateTs');
        } else if(State.dashboard.version!==prevVer && State.dashboard.version!==tgt){
          // Version hat sich verändert, aber nicht identisch zum erwarteten Ziel -> trotzdem Erfolg melden
          toast('Firmware geändert ('+State.dashboard.version+')','success');
          localStorage.removeItem('rcPendingUpdateTarget');
          localStorage.removeItem('rcPendingUpdatePrev');
          localStorage.removeItem('rcPendingUpdateTs');
        } else if(ts && Date.now()-ts>60000){
          toast('Update fehlgeschlagen (Version unverändert)','error');
          localStorage.removeItem('rcPendingUpdateTarget');
          localStorage.removeItem('rcPendingUpdatePrev');
          localStorage.removeItem('rcPendingUpdateTs');
        }
      }
    }catch(_){ }
    const stRe=State.dashboard?.stage;
  // Regression NICHT mehr automatisch erzwingen, damit der abgeschlossene Wizard nicht erneut erscheint.
  // Falls künftig ein Factory-Reset entdeckt werden soll, sollte Backend stage wieder auf 'wifi' setzen UND rcWizardDone löschen.
    let stepBefore=State.step; const newStage=State.dashboard?.stage;
    if(State.wizardMode && !suppressWizard){
      const st=State.dashboard?.stage;
    if(st==='wifi'){
      const looksLikeSetup = State.dashboard?.apMode || !State.dashboard?.online || !State.dashboard?.wifi_ssid;
      if(looksLikeSetup){ State.step=0; }
    } else if(st==='adminpass'){ State.step=1; }
    else if(st==='address'){ State.step=2; }
    else if(st==='events'){ State.step=3; }
    else if(st==='done'){
      if(localStorage.getItem('rcWizardDone')!=='1') localStorage.setItem('rcWizardDone','1');
      if(State.dashboard && State.dashboard.authRequired && !State.dashboard.authed){ State.wizardMode=true; State.step=4; }
      else { State.wizardMode=false; State.view='Dashboard'; }
    }
    }
    // Wenn lokale Farbauswahl existiert und Server liefert Defaults, nicht überschreiben
    // Waste color handling removed in Kids version
  // Delta-basiertes Rendern: Nur wenn Stage wechselt, neue Waste Events eintreffen oder explizit force
  const gotWaste = false; // waste removed
  const ae=document.activeElement; const focusInputs=['ssid','password','addrCity','addrPostal','ical','birthday_name','birthday_date','single_name','single_date','series_name','date'];
  const focusBlock = ae && ae.tagName==='INPUT' && focusInputs.includes(ae.name);
  const recentInput = Date.now() - (State.lastInputActivity||0) < 8000;
  const inEventsStep = State.wizardMode && State.step===3;
  const editingHold = inEventsStep && (focusBlock || State.editingActive || recentInput);
  if(force || prevStage!==newStage || gotWaste || (!editingHold && !focusBlock)){
    render();
  }
  }
  // Dashboard Loop nur außerhalb des Wizards aktiv
  function startDashboardLoop(){ if(State.dashTimer) return; State.dashTimer=setInterval(()=>{ if(!State.wizardMode) refreshDashboard(false); },5000);} 
  function stopDashboardLoop(){ if(State.dashTimer){ clearInterval(State.dashTimer); State.dashTimer=null; } }
  // Während Wizard deaktivieren wir die Dashboard-Schleife vollständig
  if(State.wizardMode){ stopDashboardLoop(); }
  async function factoryReset(){
    // Zweite Sicherheitsabfrage (erste in factoryResetConfirm) bleibt für direkte Aufrufe bestehen
  if(confirm('Zurücksetzen und neu starten?')) {
      try {
        // Lokale Wizard-Flags sofort löschen, damit nach Reload Wizard wieder startet
        localStorage.removeItem('rcWizardDone');
  // removed obsolete skipWaste flag
        // UI direkt in Wizard-Modus versetzen (falls Gerät etwas verzögert neu startet)
        State.wizardMode=true; State.skipWaste=false; State.step=0; State.view=null; render();
        await api('/api/settings/factory-reset',{method:'POST'});
  toast('Factory reset enabled. Device will restart...','warn');
    beginRebootWatch(true);
      } catch(e){ /* ignore */ }
    }
  }
  async function saveBrightness(form){
    const data=Object.fromEntries(new FormData(form).entries());
    const btn=form.querySelector('button[type=submit]'); const done=setLoading(btn);
  try { await api('/api/settings/brightness',{method:'POST',body:JSON.stringify(data)}); toast('LED settings saved','success');
    // Lokale Dashboard-Werte direkt anpassen
    if(State.dashboard){ const pct=parseInt(data.brightnessPercent||data.brightness||0,10); if(pct>0){ State.dashboard.rawBrightness = Math.round(pct*255/100); State.dashboard.brightness = pct; } }
    // Farbe lokal übernehmen und sofort Dashboard + Anzeige aktualisieren (force render)
    if(data.color){ let c=data.color; if(!c.startsWith('#')) c='#'+c; State.dashboard.color=c; }
    await refreshDashboard(true);
  } catch(e){ toast('Error','error'); } finally { done(); State.editingActive=false; }
  }
  async function saveExtraColors(wrap){
    const rows=[...wrap.querySelectorAll('.pal-row')];
  if(!rows.length){ toast('No palette','warn'); return; }
    const out={}; rows.forEach(r=>{ const lbl=r.querySelector('.pal-label'); if(lbl && r.dataset.sel) out[lbl.textContent]=r.dataset.sel; });
  if(Object.keys(out).length===0){ toast('No selection','warn'); return; }
    const btn=wrap.parentElement?.querySelector('button.secondary'); const done=setLoading(btn);
  try{ await api('/api/settings/extra-colors',{method:'POST',body:JSON.stringify(out)}); toast('Colors saved','success'); await refreshDashboard(true); }
    catch(e){ toast('Save failed','error'); } finally { done(); }
  }
  async function saveWeatherWords(form){ const data=Object.fromEntries(new FormData(form).entries()); const payload={}; const map=[['REGEN','#0000FF']];
    map.forEach(([k,def])=>{ const mode=(data[k+'_mode']||'auto'); let col=(data[k+'_col']||def); if(col && !col.startsWith('#')) col='#'+col; payload[k]={enabled:(mode==='auto'),color:col}; });
    const btn=form.querySelector('button[type=submit]'); const done=setLoading(btn);
  try{ await api('/api/settings/weather-words',{method:'POST',body:JSON.stringify(payload)}); toast('Saved','success'); await refreshDashboard(true); }
  catch(e){ toast('Save failed','error'); } finally { done(); }
  }
  // entfernt: veraltete Import-Implementierung mit doppelter Definition
  // Ersetze ad-hoc Poll-Logik durch gezielten Poll Mode
  // importWaste removed
  // Removed waste & markets related functions in Kids version
  // --- Events/Birthdays API integration ---
  async function loadEvents(){
  try { const res= await api('/api/events'); State.events = res; State.eventsLoaded=true; render(); }
  catch(e){ toast('Failed to load events','error'); }
  }
  function parseDateParts(iso){ if(!iso||iso.length<10) return null; return {y:parseInt(iso.substring(0,4)), m:parseInt(iso.substring(5,7)), d:parseInt(iso.substring(8,10))}; }
  async function submitBirthday(form){ const d=Object.fromEntries(new FormData(form).entries()); if(d.id){ // edit: allow only name change for simplicity
      const btn=form.querySelector('button[type=submit]'); const done=setLoading(btn);
  const payload={}; if(d.name) payload.name=d.name; try{ await putEvent(d.id,payload); toast('Updated','success'); State.editEvent=null; loadEvents(); form.reset(); }catch(e){ toast(e.message||'Error','error'); } finally { done(); }
      return;
  }
  // Wizard uses birthday_date as field name -> map to date
  if(!d.name && d.birthday_name) d.name = d.birthday_name;
  if(!d.date && d.birthday_date) d.date = d.birthday_date;
  if(!d.date){ toast('Missing date','warn'); return; } const p=parseDateParts(d.date); if(!p){ toast('Invalid date','error'); return; }
    const payload={type:'birthday', name:d.name||'Birthday', month:p.m, day:p.d}; const btn=form.querySelector('button[type=submit]'); const done2=setLoading(btn); try{ await postEvent(payload); toast('Birthday saved','success');
      // Nach Erfolg: Draft leeren und frische Eingabe ermöglichen
      if(State.wizardMode && State.step===3){ State.draftBirthday={name:'',date:''}; }
      form.reset();
      loadEvents();
      // Fokus zurück auf das Namensfeld im Wizard
      if(State.wizardMode && State.step===3){ setTimeout(()=>{ const el=document.querySelector('input[name="birthday_name"]'); if(el) el.focus(); }, 50); }
  }catch(e){ toast(e.message||'Error','error'); } finally { done2(); } }
  async function postEvent(obj){
    try{
      let r= await fetch('/api/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)});
      if(!r.ok){
        const payload='body='+encodeURIComponent(JSON.stringify(obj));
        r= await fetch('/api/events',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:payload});
      }
      if(!r.ok) throw new Error('HTTP '+r.status);
      // Nach erfolgreichem Speichern Dashboard aktualisieren (Status-Badges)
      // Wichtig: Im Wizard (Events-Schritt) NICHT automatisch die Stage fortschalten
      refreshDashboard(false,{suppressWizard:true});
      return true;
    }catch(e){ console.error('[Events] post fail',e); throw e; }
  }
  async function submitSingle(form){ const d=Object.fromEntries(new FormData(form).entries()); if(d.id){ const payload={}; const btn=form.querySelector('button[type=submit]'); const done=setLoading(btn); if(!d.name && d.single_name) d.name=d.single_name; if(d.name) payload.name=d.name; if(d.date) payload.date=d.date; if(d.single_date && !payload.date) payload.date=d.single_date; if(d.color) payload.color=d.color; try{ await putEvent(d.id,payload); toast('Updated','success'); State.editEvent=null; loadEvents(); form.reset(); }catch(e){ toast(e.message||'Error','error'); } finally { done(); } return; }
    // Wizard uses single_date as field name -> map
    if(!d.name && d.single_name) d.name = d.single_name;
    if(!d.date && d.single_date) d.date = d.single_date;
    if(!d.date){ toast('Datum fehlt','warn'); return;}
    // Datum normalisieren: akzeptiere YYYY-MM-DD oder DD.MM.YYYY
    let iso = d.date.trim();
    if(/^[0-9]{1,2}\.[0-9]{1,2}\.[0-9]{2,4}$/.test(iso)){
      const parts=iso.split('.'); let dd=parseInt(parts[0],10); let mm=parseInt(parts[1],10); let yy=parseInt(parts[2],10); if(yy<100){ yy += (yy>=70?1900:2000); }
      if(yy>1900 && mm>=1&&mm<=12 && dd>=1&&dd<=31){ iso = `${yy.toString().padStart(4,'0')}-${mm.toString().padStart(2,'0')}-${dd.toString().padStart(2,'0')}`; }
    }
  if(!/^\d{4}-\d{2}-\d{2}$/.test(iso)){ toast('Invalid date','error'); return; }
    // Zusätzlich year/month/day mitsenden für Backend-Fallback
    const y=parseInt(iso.substring(0,4),10), m=parseInt(iso.substring(5,7),10), da=parseInt(iso.substring(8,10),10);
  const payload={type:'single', name:d.name||'Event', date:iso, year:y, month:m, day:da, color:d.color||'#ff8800'};
  const btn=form.querySelector('button[type=submit]'); const done2=setLoading(btn); try{ await postEvent(payload); toast('Event saved','success');
      // Nach Erfolg: Draft leeren und frische Eingabe ermöglichen
      if(State.wizardMode && State.step===3){ State.draftSingle={name:'',date:'',color:'#ff8800'}; }
      form.reset();
      loadEvents();
      if(State.wizardMode && State.step===3){ setTimeout(()=>{ const el=document.querySelector('input[name="single_name"]'); if(el) el.focus(); }, 50); }
  }catch(e){ toast(e.message||'Error','error'); } finally { done2(); } }
  function collectWeekdays(form){ return Array.from(form.querySelectorAll('input[name=wd]:checked')).map(i=>parseInt(i.value)); }
  async function submitSeries(form){ const d=Object.fromEntries(new FormData(form).entries()); const wds=collectWeekdays(form); if(d.id){ const payload={}; const btn=form.querySelector('button[type=submit]'); const done=setLoading(btn); if(d.name) payload.name=d.name; if(d.recur) payload.recur=d.recur; if(wds.length) payload.weekdays=wds; if(d.color) payload.color=d.color; if(d.recur==='monthly' && d.monthly_pos) payload.monthly_pos=parseInt(d.monthly_pos); try{ await putEvent(d.id,payload); toast('Updated','success'); State.editEvent=null; loadEvents(); form.reset(); }catch(e){ toast(e.message||'Error','error'); } finally { done(); } return; }
  if(!d.name && d.series_name) d.name = d.series_name;
  if(!wds.length){ toast('Select at least one weekday','warn'); return; } const payload={type:'series', name:d.name||'Series', recur:d.recur||'weekly', weekdays:wds, color:d.color||'#33aaff'}; if(d.recur==='monthly' && d.monthly_pos) payload.monthly_pos=parseInt(d.monthly_pos); const btn=form.querySelector('button[type=submit]'); const done2=setLoading(btn); try{ await postEvent(payload); toast('Series saved','success');
      // Nach Erfolg: Draft leeren und frisches Formular
      if(State.wizardMode && State.step===3){ State.draftSeries={name:'',recur:'weekly',monthly_pos:'',weekdays:[],color:'#33aaff'}; }
      form.reset(); toggleMonthlyPos(form); loadEvents();
      if(State.wizardMode && State.step===3){ setTimeout(()=>{ const el=document.querySelector('input[name="series_name"]'); if(el) el.focus(); }, 50); }
  }catch(e){ toast(e.message||'Error','error'); } finally { done2(); } }
  async function putEvent(id,obj){ try{ let r= await fetch('/api/events?id='+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(obj)}); if(!r.ok){ const payload='body='+encodeURIComponent(JSON.stringify(obj)); r= await fetch('/api/events?id='+id,{method:'PUT',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:payload}); } if(!r.ok) throw new Error('HTTP '+r.status); return true; }catch(e){ console.error('[Events] put fail',e); throw e; } }
  async function deleteEvent(id){ if(!confirm('Delete?')) return; try{ await fetch('/api/events?id='+id,{method:'DELETE'}); toast('Deleted','success'); loadEvents(); }catch(e){ toast('Delete failed','error'); } }
  function toggleMonthlyPos(form){ const sel=form.querySelector('select[name=recur]'); const mp=form.querySelector('select[name=monthly_pos]'); if(!sel||!mp) return; if(sel.value==='monthly'){ mp.style.display=''; } else { mp.style.display='none'; mp.value=''; } }

  // Wizard-specific helpers for events
  function fieldInline(label,name,type,value,fkey){ return h('label',{class:'field'},label,h('input',{name,type,value:value||'', 'data-fkey':fkey||name})); }
  function labelWrap(label,el){ return h('label',{class:'field'},label,el); }
  async function addBirthdayWizard(form){ await submitBirthday(form); }
  async function addSingleWizard(form){ await submitSingle(form); }
  async function addSeriesWizard(form){ await submitSeries(form); }

  // ---- Modal Handling for Events ----
  function openEventModal(type, ev){
    const existing=document.getElementById('modal-backdrop'); if(existing) existing.remove();
    const backdrop=document.createElement('div'); backdrop.id='modal-backdrop'; backdrop.className='modal-backdrop';
    const modal=document.createElement('div'); modal.className='modal';
  const title=document.createElement('h2'); title.textContent=(ev? 'Edit: ' : 'New: ')+ (type==='birthday'?'Birthday': type==='single'?'Event':'Recurring event');
    const closeBtn=document.createElement('button'); closeBtn.className='modal-close'; closeBtn.textContent='×'; closeBtn.type='button'; closeBtn.onclick=()=>backdrop.remove();
    modal.appendChild(closeBtn);
    modal.appendChild(title);
    const form=document.createElement('form'); form.className='event-form';
    if(ev) form.appendChild(createHidden('id',ev.id));
    if(type==='birthday') buildBirthdayForm(form,ev);
    else if(type==='single') buildSingleForm(form,ev);
    else buildSeriesForm(form,ev);
  const actions=document.createElement('div'); actions.className='actions actions-compact';
  const save=document.createElement('button'); save.type='submit'; save.textContent= ev? 'Update':'Save';
    // Delete now only inside modal
  if(ev){ const del=document.createElement('button'); del.type='button'; del.textContent='Delete'; del.className='danger'; del.onclick=()=>{ if(confirm('Delete?')){ deleteEvent(ev.id); backdrop.remove(); } }; actions.appendChild(del); }
    // Pause controls only for existing series events
    if(ev && type==='series'){
      const pauseWrap=document.createElement('div'); pauseWrap.className='inline-pause mobile-stack';
      const statusSpan=document.createElement('div'); statusSpan.className='pause-status';
      const todayIso=new Date().toISOString().substring(0,10);
      if(ev.pause_until && todayIso < ev.pause_until){
        statusSpan.textContent = 'Paused until ' + ev.pause_until + (ev.next_active ? (' (next: ' + ev.next_active + ')') : '');
      } else if(ev.pause_until){
        statusSpan.textContent='Pause ended ('+ev.pause_until+')';
      } else {
        statusSpan.textContent='Active';
      }
      const row=document.createElement('div'); row.className='pause-row';
  const sel=document.createElement('select'); sel.name='pause_weeks'; sel.className='pause-select'; ['','1','2','3','4','6','8'].forEach(w=>{ const opt=document.createElement('option'); opt.value=w; opt.textContent= w===''?'- Weeks -': w+'w'; sel.appendChild(opt); });
  const btnPause=document.createElement('button'); btnPause.type='button'; btnPause.textContent='Pause'; btnPause.className='secondary';
  btnPause.onclick=()=>{ const w=sel.value; if(!w){ alert('Duration'); return; } const weeks=parseInt(w,10); const resume=new Date(Date.now()+weeks*7*86400000); const iso=resume.toISOString().substring(0,10); putEvent(ev.id,{pause_until:iso}).then(()=>{ toast('Paused until '+iso,'success'); loadEvents(); backdrop.remove(); }).catch(()=>toast('Error','error')); };
  const btnResume=document.createElement('button'); btnResume.type='button'; btnResume.textContent='Resume'; btnResume.className='secondary';
  btnResume.onclick=()=>{ putEvent(ev.id,{pause_until:''}).then(()=>{ toast('Resumed','success'); loadEvents(); backdrop.remove(); }).catch(()=>toast('Error','error')); };
      row.appendChild(sel); row.appendChild(btnPause); row.appendChild(btnResume);
      pauseWrap.appendChild(statusSpan); pauseWrap.appendChild(row);
      actions.appendChild(pauseWrap);
    }
    actions.appendChild(save);
    form.appendChild(actions);
    form.onsubmit=(e)=>{
      e.preventDefault();
      if(type==='birthday') submitBirthday(form);
      else if(type==='single') submitSingle(form);
      else submitSeries(form);
      // Close after short delay to allow toast
      setTimeout(()=>{ if(document.getElementById('modal-backdrop')) backdrop.remove(); },300);
    };
    modal.appendChild(form);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    setTimeout(()=>{ const first=form.querySelector('input,select'); if(first) first.focus(); },10);
  }
  function createHidden(name,val){ const i=document.createElement('input'); i.type='hidden'; i.name=name; i.value=val; return i; }
  function buildBirthdayForm(form,ev){
    form.appendChild(labelWrapSimple('Name',inputText('name',ev?ev.name:'')));
    if(!ev){ form.appendChild(labelWrapSimple('Date',inputField('date','date',''))); }
  }
  function buildSingleForm(form,ev){
    form.appendChild(labelWrapSimple('Name',inputText('name',ev?ev.name:'')));
    form.appendChild(labelWrapSimple('Date',inputField('date','date',ev?ev.date:'')));
    form.appendChild(labelWrapSimple('Color',inputField('color','color',ev?(ev.color||'#ff8800'):'#ff8800')));
  }
  function buildSeriesForm(form,ev){
    form.appendChild(labelWrapSimple('Name',inputText('name',ev?ev.name:'')));
    const recur=inputSelect('recur',['weekly','biweekly','monthly'], ev?ev.recur:'weekly'); form.appendChild(labelWrapSimple('Recurrence',recur));
    const mp=inputSelect('monthly_pos',['','1','2','3','4'], ev? (ev.monthly_pos?String(ev.monthly_pos):'') : ''); mp.style.display= (recur.value==='monthly')?'':'none'; form.appendChild(labelWrapSimple('Monthly position',mp));
    recur.addEventListener('change',()=>{ mp.style.display= recur.value==='monthly'? '' : 'none'; if(recur.value!=='monthly') mp.value=''; });
    const wdWrap=document.createElement('div'); wdWrap.className='weekday-select'; ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].forEach((lbl,i)=>{ const idx=i+1; const lab=document.createElement('label'); lab.className='wd'; const cb=document.createElement('input'); cb.type='checkbox'; cb.name='wd'; cb.value=String(idx); if(ev && Array.isArray(ev.weekdays) && ev.weekdays.includes(idx)) cb.checked=true; lab.appendChild(cb); lab.appendChild(document.createTextNode(lbl)); wdWrap.appendChild(lab); });
    form.appendChild(labelWrapSimple('Weekdays',wdWrap));
    form.appendChild(labelWrapSimple('Color',inputField('color','color',ev?(ev.color||'#33aaff'):'#33aaff')));
  }
  function inputText(name,val){ return inputField(name,'text',val); }
  function inputField(name,type,val){ const i=document.createElement('input'); i.name=name; i.type=type; if(val!=null) i.value=val; return i; }
  function inputSelect(name,options,val){ const s=document.createElement('select'); s.name=name; options.forEach(o=>{ const opt=document.createElement('option'); opt.value=o; opt.textContent= o===''?'- Pos -': (o==='weekly'?'Weekly': o==='biweekly'?'Bi-weekly': o==='monthly'?'Monthly': o); if(o===val) opt.selected=true; s.appendChild(opt); }); return s; }
  function labelWrapSimple(label,el){ const l=document.createElement('label'); l.className='field'; const span=document.createElement('span'); span.textContent=label; l.appendChild(span); l.appendChild(el); return l; }

  // showRestartHint entfernt (MQTT entfernt)

  function beginRebootWatch(longWait){
    if(State.rebootWatching) return;
    State.rebootWatching=true;
    try{ toast('Connecting to network, please wait…','info',3000); }catch(_){ }
    let sawDown=false; const start=Date.now();
    const maxMs= longWait? 45000 : 25000;
  let redirected=false; let triedIP=false;
    const redirectToMdns=()=>{
      if(redirected) return; redirected=true;
      try{
        const base = (State.dashboard?.hostname || 'RemindiKids').toString().toLowerCase();
        const url = 'http://'+base+'/';
        window.location.href = url;
      }catch(_){ try{ window.location.href = 'http://remindikids/'; }catch(__){} }
    };
    const redirectToIp=(ip)=>{ if(redirected||!ip) return; redirected=true; try{ window.location.href = 'http://'+ip; }catch(_){ } };
    const attempt=()=>{
      fetch('/api/dashboard',{cache:'no-store'}).then(r=>{
        if(!r.ok) throw new Error('bad');
        if(sawDown){
          // Falls wir im letzten Connect die IP erhalten haben, nutze sie
          const ip = (window.__lastWifiIP||'');
          if(ip && !triedIP){ triedIP=true; redirectToIp(ip); return; }
          redirectToMdns();
        }
        else { if(Date.now()-start>maxMs){ redirectToMdns(); return; } setTimeout(attempt,1000); }
      }).catch(()=>{ sawDown=true; if(Date.now()-start>maxMs){ location.reload(); return; } setTimeout(attempt,1500); });
    };
    // Merke IP aus letztem Connect-Call im globalen Window-Scope, damit beginRebootWatch sie verwenden kann
    try{ if(window.__lastWifiIP==null){ window.__lastWifiIP=''; } }catch(_){}
    // Start Poll + Fallback-Redirect
  setTimeout(()=>{ attempt(); setTimeout(()=>{ if(sawDown && !redirected){ const ip=(window.__lastWifiIP||''); if(ip) redirectToIp(ip); else redirectToMdns(); } }, 9000); }, longWait? 3000 : 1500);
  }

  // Init
  function pushAppState(){/* legacy noop */}
  window.addEventListener('popstate',e=>{
    if(e.state && e.state.app){
      State.wizardMode=e.state.wizard;
      State.step=e.state.step;
      State.view=e.state.view;
      State.subView=e.state.sub;
      render();
    } else {
      // If no state (e.g., user opened with deep hash) just reinsert current
      try{ history.replaceState({app:1,wizard:State.wizardMode,step:State.step,view:State.view,sub:State.subView},''); }catch(_){ }
    }
  });
  // Wizard-Initialisierung robuster: Nur Wizard anzeigen, wenn Stage wirklich 'wifi' unter AP/ohne Online ist oder explizit noch Pflichtschritte anstehen.
  if(State.dashboard?.stage==='done' && localStorage.getItem('rcWizardDone')==='1') {
    State.wizardMode=false; State.view='Dashboard';
  } else if(State.dashboard?.stage==='wifi') {
    const looksLikeSetup = State.dashboard?.apMode || !State.dashboard?.online || !State.dashboard?.wifi_ssid;
    State.wizardMode = !!looksLikeSetup;
  } else {
    State.wizardMode=true;
  }
  // skipWaste flag removed
  pollForStage();
  refreshDashboard(true);
  render();
  // Initial history state already replaced in first render
  // Loop nur starten wenn Wizard bereits abgeschlossen ist
  if(!State.wizardMode) startDashboardLoop();
  // --- Global input activity tracking to prevent focus loss ---
  document.addEventListener('focusin',e=>{ if(e.target && ['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)){ State.editingActive=true; }});
  document.addEventListener('focusout',e=>{ if(e.target && ['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)){ setTimeout(()=>{ if(!document.activeElement || !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) State.editingActive=false; },120); }});
  document.addEventListener('input',e=>{ if(e.target && ['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName)){ State.lastInputActivity=Date.now(); }});
  // Pointer-Interaktion ebenfalls als Aktivität zählen (relevant für mobile Datepicker, die Fokus entziehen)
  document.addEventListener('pointerdown',e=>{ if(e.target && e.target.tagName==='INPUT'){ State.lastInputActivity=Date.now(); }});

  // Auto-Logout nach Inaktivität (Client-seitig), ergänzt serverseitiges 1h-Timeout
  State.lastActivityTs = Date.now();
  const bumpActivity = ()=>{ State.lastActivityTs = Date.now(); };
  ['pointerdown','keydown','wheel','touchstart','focusin','input'].forEach(evt=>document.addEventListener(evt,bumpActivity,{passive:true}));
  const INACT_MS = 50*60*1000; // 50 Minuten
  setInterval(async ()=>{
    if(!State.dashboard || !State.dashboard.authRequired) return;
    if(State.dashboard && State.dashboard.authed){
      const idle = Date.now() - (State.lastActivityTs||0);
      if(idle > INACT_MS){
        try{ await fetch('/api/auth/logout',{method:'POST'}); }catch(_){ }
        await refreshDashboard(true);
        showLoginGate();
      }
    }
  }, 30000);

  // Generic loading helper
  function setLoading(btn){
    if(!btn) return ()=>{};
    const oldTxt=btn.textContent; btn.disabled=true; btn.classList.add('loading'); btn.textContent='...';
    return ()=>{ btn.disabled=false; btn.classList.remove('loading'); btn.textContent=oldTxt; };
  }
})();
