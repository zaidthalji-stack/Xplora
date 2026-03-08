// ══════════════════════════════════════════════
// BIDIRECTIONAL BRIDGE v1.5 — Baitak.ai
// Show on map → filter + navigate one by one
// ══════════════════════════════════════════════

const MapBridge = (() => {
  let highlightedMarkers = [];
  let lastMatchedProjects = [];
  let selectedMapProject = null;
  let isFiltered = false;
  let filterResetBtn = null;
  let navBar = null;
  let tempCluster = null;
  let currentNavIndex = 0;
  const processedMsgIds = new Set();

  // ── SEARCH ENGINE ──
  function searchProperties(query) {
    const q = query.toLowerCase().trim();
    const tokens = q.split(/\s+/).filter(t => t.length > 1);
    const seedProjects = P.filter(p => !p._parent);
    const areaAliases = {
      'marina':['dubai marina'],'jvc':['jumeirah village circle'],
      'jvt':['jumeirah village triangle'],'downtown':['downtown dubai'],
      'business bay':['business bay'],'jlt':['jumeirah lakes towers'],
      'palm':['palm jumeirah'],'hills':['dubai hills estate'],
      'creek':['dubai creek harbour'],'arjan':['al barsha south'],
      'dso':['dubai silicon oasis'],'dip':['dubai investment park'],
      'sports city':['dubai sports city'],'motor city':['motor city'],
      'mbr':['mbr city'],'meydan':['meydan'],'jbr':['jumeirah beach residence'],
      'difc':['difc'],'production city':['dubai production city'],
      'studio city':['dubai studio city'],'al furjan':['al furjan'],
      'dubai south':['dubai south'],'expo':['expo city dubai'],
      'beachfront':['emaar beachfront'],'lagoons':['damac lagoons'],
      'hartland':['sobha hartland'],'oasis':['emaar the oasis'],
    };
    const matchedAreas = [];
    for (const [alias, fullNames] of Object.entries(areaAliases)) {
      if (q.includes(alias)) matchedAreas.push(...fullNames);
    }
    const scored = seedProjects.map(proj => {
      let score = 0;
      const mi = MI[proj.n] || {};
      const hay = [proj.n,proj.d,proj.c,proj.desc||'',proj.s||'',proj.t||'',proj.p||'',mi.bestFor?.join(' ')||''].join(' ').toLowerCase();
      const pn = proj.n.toLowerCase();
      for (const a of matchedAreas) { if (pn.includes(a)){score+=10;break;} }
      tokens.forEach(t => { if(pn.includes(t))score+=4;else if(proj.d.toLowerCase().includes(t))score+=2;else if(hay.includes(t))score+=1; });
      if(/studio/i.test(q)&&/studio/i.test(hay))score+=3;
      if(/villa/i.test(q)&&/villa/i.test(hay))score+=3;
      if(/penthouse/i.test(q)&&/penthouse/i.test(hay))score+=3;
      if(/townhouse/i.test(q)&&/townhouse/i.test(hay))score+=3;
      const gm={'rental':'rental-income','yield':'rental-income','income':'rental-income','capital':'capital-appreciation','growth':'capital-appreciation','invest':'capital-appreciation','family':'family-home','kids':'family-home','first home':'first-home','starter':'first-home','affordable':'first-home','budget':'first-home','branded':'branded-prestige','luxury':'branded-prestige','flip':'flip','growing':'growing-area','emerging':'growing-area','holiday':'holiday-home','vacation':'holiday-home'};
      for(const[kw,intent]of Object.entries(gm)){if(q.includes(kw)&&mi.bestFor?.includes(intent))score+=5;}
      const pm=q.match(/under\s+([\d.]+)\s*(m|million)?/i);
      if(pm){const n=parseFloat(pm[1]);const t=(pm[2]||n<100)?n*1e6:n;const mp=parseFloat(proj.p.match(/[\d.]+/)?.[0]||999);const ml=proj.p.includes('M')?1e6:proj.p.includes('K')?1e3:1;if(mp*ml<=t)score+=3;}
      return{proj,score};
    });
    const results = scored.filter(s=>s.score>0).sort((a,b)=>b.score-a.score);
    if(matchedAreas.length>0){const ar=results.filter(r=>r.score>=10);if(ar.length>0)return ar.slice(0,6);}
    return results.slice(0,6);
  }

  // ── CLEANUP ──
  function cleanupPrevious() {
    if(tempCluster){try{map.removeLayer(tempCluster)}catch(e){}tempCluster=null;}
    highlightedMarkers.forEach(m=>{try{map.removeLayer(m)}catch(e){}});
    highlightedMarkers=[];
    if(filterResetBtn){filterResetBtn.remove();filterResetBtn=null;}
    if(navBar){navBar.remove();navBar=null;}
  }

  // ── FILTER MAP ──
  function filterMapTo(projects) {
    cleanupPrevious();
    const matchedParents = new Set(projects.map(p=>p.n));

    // Hide all original layers
    Object.values(markerLayers).forEach(layer=>{if(map.hasLayer(layer))map.removeLayer(layer);});

    // Build temp cluster
    tempCluster = L.markerClusterGroup({maxClusterRadius:40,spiderfyOnMaxZoom:true,showCoverageOnHover:false,zoomToBoundsOnClick:true,disableClusteringAtZoom:14});
    let count=0;
    allMarkers.forEach(({marker,data})=>{
      const pn=data._parent||data.n;
      if(matchedParents.has(data.n)||matchedParents.has(pn)){tempCluster.addLayer(marker);count++;}
    });
    tempCluster.addTo(map);
    isFiltered=true;

    // Add highlight circles
    projects.forEach((proj,i)=>{
      const c=L.circleMarker([proj.lat,proj.lng],{radius:projects.length===1?24:18,color:'#00e5a0',weight:2.5,opacity:.9,fillColor:'#00e5a0',fillOpacity:.1}).addTo(map);
      const el=c.getElement();
      if(el){el.style.animation=`bridgePulse 2s ease-in-out infinite ${i*.2}s`;el.style.pointerEvents='none';}
      highlightedMarkers.push(c);
    });

    lastMatchedProjects=projects;
    currentNavIndex=0;

    // Zoom to first project
    zoomToProject(0);

    // Show nav bar if multiple
    if(projects.length>1) showNavBar(projects);
    else showResetButton(1);

    const counter=document.getElementById('counter');
    if(counter)counter.innerHTML=`Filtered: <b>${projects.length}</b> projects (<b>${count}</b> listings) · <span style="color:var(--accent);cursor:pointer;text-decoration:underline" onclick="MapBridge.resetFilter()">Show all</span>`;

    console.log(`🗺️ MapBridge: Filtered to ${projects.length} projects (${count} markers)`);
  }

  function zoomToProject(index) {
    const proj = lastMatchedProjects[index];
    if(!proj) return;
    currentNavIndex = index;
    map.flyTo([proj.lat, proj.lng], 15, {duration:1});
    // Open popup after fly
    setTimeout(()=>{
      const m = allMarkers.find(m=>m.data.n===proj.n&&!m.data._parent);
      if(m) m.marker.openPopup();
    },1100);
    // Update nav bar active state
    if(navBar) updateNavBar(index);
  }

  function showNavBar(projects) {
    if(navBar) navBar.remove();
    navBar = document.createElement('div');
    navBar.style.cssText = 'position:absolute;top:104px;left:16px;z-index:1000;display:flex;align-items:center;gap:4px;padding:4px 6px;background:var(--panel);border:1px solid var(--ba);border-radius:10px;backdrop-filter:blur(12px);animation:msgIn .3s ease;max-width:calc(100vw - 32px);flex-wrap:wrap';

    // Reset button
    const reset = document.createElement('div');
    reset.style.cssText='padding:4px 8px;border-radius:6px;font-size:9px;color:var(--t3);cursor:pointer;display:flex;align-items:center;gap:3px;transition:all .2s';
    reset.innerHTML='<span style="font-size:12px">✕</span>';
    reset.title='Show all projects';
    reset.addEventListener('click',()=>resetFilter());
    reset.addEventListener('mouseover',function(){this.style.color='var(--red)';});
    reset.addEventListener('mouseout',function(){this.style.color='var(--t3)';});
    navBar.appendChild(reset);

    // Prev arrow
    const prev = document.createElement('div');
    prev.style.cssText='padding:3px 6px;border-radius:4px;font-size:14px;color:var(--t2);cursor:pointer;transition:all .15s;user-select:none';
    prev.textContent='‹';
    prev.addEventListener('click',()=>{
      const idx=(currentNavIndex-1+lastMatchedProjects.length)%lastMatchedProjects.length;
      zoomToProject(idx);
    });
    prev.addEventListener('mouseover',function(){this.style.color='var(--accent)';});
    prev.addEventListener('mouseout',function(){this.style.color='var(--t2)';});
    navBar.appendChild(prev);

    // Project pills
    projects.forEach((proj,i)=>{
      const pill = document.createElement('div');
      pill.className = 'nav-pill';
      pill.dataset.index = i;
      const shortName = proj.n.length>18 ? proj.n.substring(0,16)+'…' : proj.n;
      pill.style.cssText=`padding:4px 8px;border-radius:6px;font-size:9px;font-weight:500;cursor:pointer;transition:all .2s;white-space:nowrap;border:1px solid transparent;${i===0?'background:rgba(0,229,160,.12);color:var(--accent);border-color:rgba(0,229,160,.3)':'background:transparent;color:var(--t2)'}`;
      pill.textContent=shortName;
      pill.addEventListener('click',()=>zoomToProject(i));
      pill.addEventListener('mouseover',function(){if(currentNavIndex!==i)this.style.color='var(--t1)';});
      pill.addEventListener('mouseout',function(){if(currentNavIndex!==i)this.style.color='var(--t2)';});
      navBar.appendChild(pill);
    });

    // Next arrow
    const next = document.createElement('div');
    next.style.cssText='padding:3px 6px;border-radius:4px;font-size:14px;color:var(--t2);cursor:pointer;transition:all .15s;user-select:none';
    next.textContent='›';
    next.addEventListener('click',()=>{
      const idx=(currentNavIndex+1)%lastMatchedProjects.length;
      zoomToProject(idx);
    });
    next.addEventListener('mouseover',function(){this.style.color='var(--accent)';});
    next.addEventListener('mouseout',function(){this.style.color='var(--t2)';});
    navBar.appendChild(next);

    document.body.appendChild(navBar);
  }

  function updateNavBar(activeIndex) {
    if(!navBar) return;
    navBar.querySelectorAll('.nav-pill').forEach(pill=>{
      const i = parseInt(pill.dataset.index);
      if(i===activeIndex){
        pill.style.background='rgba(0,229,160,.12)';
        pill.style.color='var(--accent)';
        pill.style.borderColor='rgba(0,229,160,.3)';
      } else {
        pill.style.background='transparent';
        pill.style.color='var(--t2)';
        pill.style.borderColor='transparent';
      }
    });
  }

  function showResetButton(count) {
    if(filterResetBtn)filterResetBtn.remove();
    filterResetBtn=document.createElement('div');
    filterResetBtn.style.cssText='position:absolute;top:104px;left:16px;z-index:1000;display:flex;align-items:center;gap:6px;padding:6px 12px;background:rgba(0,229,160,.1);border:1px solid rgba(0,229,160,.3);border-radius:8px;backdrop-filter:blur(8px);cursor:pointer;transition:all .2s;animation:msgIn .3s ease';
    filterResetBtn.innerHTML=`<span style="font-size:11px;font-weight:600;color:var(--accent)">Showing ${count} project</span><span style="font-size:10px;color:var(--t2);margin-left:4px">✕ Reset</span>`;
    filterResetBtn.addEventListener('click',()=>resetFilter());
    document.body.appendChild(filterResetBtn);
  }

  // ── RESET ──
  function resetFilter() {
    cleanupPrevious();
    allMarkers.forEach(({marker,data})=>{
      if(markerLayers[data.c]&&!markerLayers[data.c].hasLayer(marker))markerLayers[data.c].addLayer(marker);
    });
    const activePill=document.querySelector('#catControls .pill.active:not([data-filter="heatmap"])');
    const cc=activePill?.dataset?.filter||'all';
    Object.entries(markerLayers).forEach(([cat,layer])=>{
      const show=cc==='all'||cat===cc;
      if(show&&!map.hasLayer(layer))layer.addTo(map);
      if(!show&&map.hasLayer(layer))map.removeLayer(layer);
    });
    isFiltered=false;
    updateCounter(P.length);
    map.flyTo([25.10,55.20],11,{duration:1});
    console.log('🗺️ MapBridge: Reset — all projects visible');
  }

  // ── MAP → CHAT ──
  function setupMarkerClickBridge() {
    allMarkers.forEach(({marker,data})=>{
      marker.on('click',()=>{
        const pn=data._parent||data.n;
        const mi=MI[pn]||{};
        selectedMapProject={...data,mi,parentName:pn};
        const ci=document.getElementById('chatInput');
        if(ci&&!activeDocument)ci.placeholder=`Ask about ${pn}...`;
        if(chatOpen)showMapContext(pn,mi,data);
      });
    });
  }

  function showMapContext(name,mi,data) {
    const md=document.getElementById('chatMessages');
    md.querySelectorAll('.bridge-context').forEach(el=>el.remove());
    const y=mi.yield?` · Yield: ${mi.yield}`:'';
    const ctx=document.createElement('div');
    ctx.className='bridge-context';
    ctx.style.cssText='padding:8px 12px;background:rgba(0,229,160,0.04);border:1px solid rgba(0,229,160,0.15);border-radius:10px;font-size:11px;display:flex;align-items:center;gap:8px;animation:msgIn .3s ease';
    ctx.innerHTML=`<div style="width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0"></div>
      <div style="flex:1;min-width:0"><div style="font-weight:600;color:var(--accent)">${esc(name)}</div><div style="color:var(--t3);font-size:9px;margin-top:1px">${data.d} · ${data.p}${y}</div></div>
      <span class="bridge-ask-btn" style="padding:3px 8px;background:rgba(0,229,160,0.1);border:1px solid rgba(0,229,160,0.2);border-radius:5px;font-size:9px;font-weight:600;color:var(--accent);cursor:pointer;white-space:nowrap">Ask AI →</span>
      <span class="bridge-dismiss" style="color:var(--t3);cursor:pointer;font-size:14px;padding:0 4px">✕</span>`;
    ctx.querySelector('.bridge-ask-btn').addEventListener('click',()=>{
      document.getElementById('chatInput').value=`Tell me about ${name} — price, yield, ROI, and who it competes with`;
      sendMessage();
    });
    ctx.querySelector('.bridge-dismiss').addEventListener('click',()=>ctx.remove());
    md.appendChild(ctx);
    scrollChat();
  }

  // ── AI RESPONSE → MAP ──
  function watchAIResponses() {
    setInterval(()=>{
      const msgs=document.querySelectorAll('#chatMessages .msg.ai');
      for(let i=0;i<msgs.length;i++){
        const msg=msgs[i];
        if(msg.querySelector('.typing-indicator'))continue;
        if(msg.querySelector('.bridge-map-btn'))continue;
        const txt=msg.textContent||'';
        if(txt.length<30)continue;
        const fp=`${i}-${txt.length}-${txt.substring(0,50)}`;
        if(processedMsgIds.has(fp))continue;
        processedMsgIds.add(fp);
        extractAndHighlight(msg);
      }
    },1500);
  }

  function extractAndHighlight(msgNode) {
    const text=(msgNode.textContent||'').toLowerCase();
    const seedProjects=P.filter(p=>!p._parent);
    const mentioned=seedProjects.filter(proj=>{
      const name=proj.n.toLowerCase();
      if(text.includes(name))return true;
      if(name.includes('jumeirah village circle')&&/\bjvc\b/.test(text))return true;
      if(name.includes('jumeirah lakes towers')&&/\bjlt\b/.test(text))return true;
      if(name.includes('jumeirah beach residence')&&/\bjbr\b/.test(text))return true;
      if(name.includes('dubai marina')&&/\bmarina\b/.test(text))return true;
      if(name.includes('business bay')&&/\bbusiness bay\b/.test(text))return true;
      if(name.includes('downtown dubai')&&/\bdowntown\b/.test(text))return true;
      if(name.includes('dubai hills estate')&&/\bdubai hills\b/.test(text))return true;
      if(name.includes('al barsha south')&&/\barjan\b/.test(text))return true;
      return false;
    });
    if(mentioned.length>0&&mentioned.length<=10){
      const btn=document.createElement('div');
      btn.className='bridge-map-btn';
      btn.style.cssText='margin-top:8px;display:inline-flex;align-items:center;gap:6px;padding:5px 12px;background:rgba(0,229,160,0.08);border:1px solid rgba(0,229,160,0.2);border-radius:6px;cursor:pointer;transition:all .2s;font-size:10px;font-weight:600;color:var(--accent);font-family:DM Sans,sans-serif';
      btn.innerHTML=`<svg viewBox="0 0 24 24" style="width:13px;height:13px;fill:var(--accent)"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>Show ${mentioned.length} on map <span style="font-weight:400;color:var(--t3);margin-left:4px">${mentioned.slice(0,3).map(p=>p.n.length>20?p.n.substring(0,18)+'…':p.n).join(' · ')}${mentioned.length>3?' +'+(mentioned.length-3):''}</span>`;
      btn.addEventListener('mouseover',function(){this.style.background='rgba(0,229,160,0.16)';});
      btn.addEventListener('mouseout',function(){this.style.background='rgba(0,229,160,0.08)';});
      btn.addEventListener('click',()=>filterMapTo(mentioned));
      msgNode.appendChild(btn);
      lastMatchedProjects=mentioned;
      console.log(`🔗 MapBridge: Found ${mentioned.length} projects in AI response`);
    }
  }

  // ── ENHANCED SEND ──
  function enhanceSendMessage() {
    const prevSend=sendMessage;
    sendMessage=async function(){
      const input=document.getElementById('chatInput');
      const text=(input.value||'').trim();
      if(!text)return prevSend();
      if(typeof pendingFloorPlan!=='undefined'&&(pendingFloorPlan||activeDocument))return prevSend();

      const results=searchProperties(text);
      if(results.length>0&&results[0].score>=6){
        filterMapTo(results.map(r=>r.proj));
        console.log(`🔍 MapBridge: "${text}" → ${results.length} matches (score: ${results[0].score})`);
      } else if(isFiltered){
        resetFilter();
      }

      if(selectedMapProject){
        selectedMapProject=null;
        const ci=document.getElementById('chatInput');
        if(ci&&!activeDocument)ci.placeholder='Ask anything, or upload a floor plan...';
      }
      return prevSend();
    };
  }

  // ── INIT ──
  function init() {
    const style=document.createElement('style');
    style.textContent=`@keyframes bridgePulse{0%,100%{opacity:.4;transform:scale(1)}50%{opacity:1;transform:scale(1.15)}}`;
    document.head.appendChild(style);
    setupMarkerClickBridge();
    watchAIResponses();
    enhanceSendMessage();
    document.addEventListener('keydown',(e)=>{
      if(e.key==='Escape'){
        if(isFiltered)resetFilter();
        else{highlightedMarkers.forEach(m=>{try{map.removeLayer(m)}catch(e){}});highlightedMarkers=[];}
        selectedMapProject=null;
        const ci=document.getElementById('chatInput');
        if(ci)ci.placeholder='Ask anything, or upload a floor plan...';
      }
      // Arrow keys navigate when filtered
      if(isFiltered&&lastMatchedProjects.length>1){
        if(e.key==='ArrowRight'||e.key==='ArrowDown'){
          e.preventDefault();
          zoomToProject((currentNavIndex+1)%lastMatchedProjects.length);
        }
        if(e.key==='ArrowLeft'||e.key==='ArrowUp'){
          e.preventDefault();
          zoomToProject((currentNavIndex-1+lastMatchedProjects.length)%lastMatchedProjects.length);
        }
      }
    });
    console.log('🔗 Baitak MapBridge v1.5: Bidirectional chat ↔ map active');
  }

  return { init, searchProperties, filterMapTo, resetFilter, askAbout:(n)=>{
    document.getElementById('chatInput').value=`Tell me about ${n}`;sendMessage();
  }};
})();

MapBridge.init();